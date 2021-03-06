import assert from 'assert';
import {buildQuery, buildCount} from './queryBuilder';
import {resolveConnection} from './relay';

/**
 * Node class
 */
class Node {

  constructor({model, related = undefined, args = {}, connection = {}, name = '', query = undefined, loadersKey = 'loaders'}) {
    assert(model, 'You need to provide a thinky Model');

    this.model = model;
    this.related = related;
    this.args = args;
    this.connection = connection;
    this.name = name; // The name will be populated based to AST name if not provided
    this.query = query;
    this.loadersKey = loadersKey;
  }

  /**
   * Resolve node based
   * a rethinkDB query
   *
   * @returns {*}
   */
  async queryResolve(loaders) {
    this.args.query = this.query;

    let queryResult;

    if (this.args.list) {
      const Query = buildQuery(this.model, this.args, this.model._thinky);
      queryResult = await Query.run();

      // If any loader are provided and there is no restriction
      // on selecting fields I can safetly cache them into dataloader
      // for subsequential calls
      if (loaders && !this.args.requestedFields) {
        queryResult.forEach(row => {
          loaders[this.getModelName()].getOrCreateLoader('loadBy', 'id')
            .prime(row.id, row);
        });
      }

      if (this.args.count) {
        const queryCountResult = await buildCount(
          this.model,
          [],
          null,
          this.args
        );

        queryResult = queryResult.map(row => {
          row.fullCount = queryCountResult;
          return row;
        });
      }
    } else {
      const Query = buildQuery(this.model, {
        ...this.args,
        offset: false
      }, this.model._thinky);
      queryResult = await Query.nth(0).default(null).run();
    }

    return queryResult;
  }

  /**
   * Resolve from tree
   *
   * @param source
   * @returns {*}
   */
  fromParentSource(source) {
    return source[this.name];
  }

  /**
   * Create a relay connection
   *
   * @returns {{connectionType, edgeType, nodeType, resolveEdge, connectionArgs, resolve}|*}
   */
  connect(resolveOptions) {
    /*eslint-disable */
    if (!this.connection.name) throw new Error("Please specify a connection name, before call connect on a Node");
    if (!this.connection.type) throw new Error("Please specify a connection type, before call connect on a Node");
    /*eslint-enable */

    return resolveConnection(this, resolveOptions);
  }

  /**
   * Resolve Node
   * @param treeSource
   * @param context
   * @returns {*}
   */
  async resolve(treeSource, context) {
    let result = treeSource;
    const loaders = context[this.loadersKey];
    if (!this.isRelated()) {
      result = await this.queryResolve(loaders);
    } else if (this.isRelated() && treeSource) {
      result = this.fromParentSource(treeSource);

      if (!loaders) {
        throw new Error(`
          GraphQL-thinky couldn't find any loaders set on the GraphQL context
          with the key "${this.loadersKey}"
        `);
      }

      if (!result && treeSource && loaders) {
        result = await this.resolveWithLoaders(treeSource, loaders);
      }
    }

    return result;
  }

  /**
   * Resolve with loaders
   * @param treeSource
   * @param loaders
   * @returns {*}
   */
  async resolveWithLoaders(treeSource, loaders) {
    let result;
    // Resolve with Loaders from the context
    const FkJoin = this.related.leftKey;
    this.args.attributes.push(FkJoin);

    if (this.related.type === 'belongsTo') {
      const loaderName = this.related.model.getTableName();
      const loader = loaders[loaderName];
      if (!loader) {
        throw new Error(`
          Loader name "${loaderName}" Not Found for relation
          when try to resolve relation ${this.related.relationName}
          of the model ${this.getModelName()}
       `);
      }
      result = await loader.loadById(treeSource[FkJoin]);
    } else {
      const loaderName = this.related.parentModelName;
      const loader = loaders[loaderName];
      if (!loader) {
        throw new Error(`
          Loader name "${loaderName}" Not Found for relation
          when try to resolve relation ${this.related.relationName}
          of the model ${this.getModelName()}`);
      }
      result = await loaders[this.related.parentModelName]
        .related(this.related.relationName, treeSource[FkJoin], this.args);
    }

    if (this.args.list) {
      return result.toArray();
    }
    return result.toObject(this.args);
  }

  /**
   * Append args
   *
   * @param args
   */
  appendArgs(args) {
    this.args = {...this.args, ...args};
  }

  /**
   * Determine if this node is a connection
   *
   * @returns {string|*}
   */
  isConnection() {
    return (this.connection.name && this.connection.type);
  }

  /**
   * Determine if the node is related
   *
   * @returns {boolean}
   */
  isRelated() {
    return Boolean(this.related);
  }

  /**
   * Get model of the Node
   *
   * @returns {*}
   */
  getModel() {
    return this.model;
  }

  /**
   * Get model Name
   *
   * @return {string}
   */
  getModelName() {
    return this.model.getTableName();
  }
}

export default Node;
