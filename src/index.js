const { messageMap } = require('./status');

module.exports = lambdaExpress;

function lambdaExpress() {
  return new LambdaExpress();
}
let g_routeIndex = 0;

const METHODS = [
  'checkout',
  'copy',
  'delete',
  'head',
  'lock',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'm-search',
  'notify',
  'options',
  'patch',
  'post',
  'purge',
  'put',
  'report',
  'search',
  'subscribe',
  'trace',
  'unlock',
  'unsubscribe',
];

class Router {
  constructor() {
    METHODS.forEach((method) => {
      this[method] = this._addMiddleware.bind(
        this,
        method.toUpperCase(),
        false
      );
    });
  }
  _middleware = [];
  _parents = [];
  all(path, ...callbacks) {
    return this._addMiddleware(undefined, false, path, ...callbacks);
  }
  get(path, ...callbacks) {
    return this._addMiddleware('GET', false, path, ...callbacks);
  }
  use(...callbacks) {
    return this._addMiddleware(undefined, true, ...callbacks);
  }
  addParent(parent, prefix) {
    this._parents.push({ parent, prefix });
    this._middleware.forEach((item) => parent.addChildMiddleware(prefix, item));
  }
  addChildMiddleware(new_prefix, item) {
    const { match, route_index, callback } = item;
    const combined =
      new_prefix || match ? _makeCombinedMatch(new_prefix, match) : undefined;
    const new_item = { match: combined, route_index, callback };
    this._middleware.push(new_item);
    this._parents.forEach(({ parent, prefix }) =>
      parent.addChildMiddleware(prefix, new_item)
    );
  }
  _addMiddleware(method, is_prefix, ...callbacks) {
    const route_index = g_routeIndex++;
    let i = 0;
    const maybe_path = callbacks[0];
    const match =
      typeof maybe_path !== 'function' && !maybe_path.addParent
        ? _makeMatch(callbacks[i++], method, is_prefix)
        : undefined;
    for (; i < callbacks.length; i++) {
      const callback = callbacks[i];
      if (callback.addParent) {
        callback.addParent(this, match);
      } else {
        const item = { match, route_index, callback: callbacks[i] };
        this._middleware.push(item);
        this._parents.forEach(({ parent, prefix }) =>
          parent.addChildMiddleware(prefix, item)
        );
      }
    }
    return this;
  }
}
lambdaExpress.Router = Router;

class LambdaExpress extends Router {
  _settings = {};
  handler = (event) => {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;
    const fresh = event.header?.['cache-control'] === 'no-cache';
    const xhr = event.header?.['x-requested-with'] === 'XMLHttpRequest';
    return new Promise((resolve, reject) => {
      let statusCode = 200;
      const headers = {};
      const req = {
        app: this,
        baseUrl: event.requestContext?.http?.path,
        body: body || {},
        cookies: event.cookies ? _cookiesToMap(event.cookies) : {},
        fresh,
        host: event.requestContext?.domainName,
        hostname: event.requestContext?.domainName,
        ip: event.requestContext?.http?.sourceIp,
        ips: [event.requestContext?.http?.sourceIp],
        method: event.requestContext?.http?.method,
        originalUrl: event.requestContext?.http?.path,
        params: {},
        path: event.requestContext?.http?.path,
        protocol: event.requestContext?.http?.protocol,
        query: event.queryStringParameters || {},
        route: {},
        secure: true,
        signedCookies: {},
        stale: !fresh,
        subdomains: [],
        xhr,
        accepts: (val) => _headerMatch(event.header?.['accept'], val),
        acceptsCharsets: (val) =>
          _headerMatch(event.header?.['accept-charset'], val),
        acceptsEncodings: (val) =>
          _headerMatch(event.header?.['accept-encoding'], val),
        acceptsLanguages: (val) =>
          _headerMatch(event.header?.['accept-language'], val),
        get: (name) => event.header?.[name],
        is: (val) => {
          return body
            ? _headerMatch(event.header?.['content-type'], val)
            : null;
        },
        range: () => {},
      };
      const res = {
        set: (field, value) => {
          if (typeof field === 'object') {
            Object.assign(headers, field);
          } else {
            headers[field] = value;
          }
          return res;
        },
        header: (...args) => res.set(...args),
        location: (loc) => res.set('location', loc),
        status: (code) => {
          statusCode = code;
          return res;
        },
        send: (response_body) => {
          if (response_body === undefined || Buffer.isBuffer(response_body)) {
            // ???
          } else if (typeof response_body === 'object') {
            response_body = JSON.stringify(response_body);
          } else if (typeof body !== 'string') {
            response_body = String(response_body);
          }

          resolve({
            statusCode,
            headers,
            body: response_body,
          });
          return res;
        },
        end: (...args) => res.send(...args),
        sendStatus: (status) => {
          statusCode = status;
          const response_body = messageMap[status] || String(status);
          return res.send(response_body);
        },
      };
      let err;
      let skip_index;
      _asyncForEach(
        this._middleware,
        (middleware, next) => {
          const { match, route_index, callback } = middleware;
          function _next(next_err) {
            if (next_err === 'route') {
              skip_index = route_index;
            } else {
              err = next_err;
            }
            next();
          }
          try {
            if (route_index === skip_index) {
              next();
            } else if (err && callback.length === 4) {
              callback(err, req, res, next);
            } else if (!err && callback.length !== 4) {
              const params = _getMatch(req, match);
              if (params) {
                req.params = params;
                callback(req, res, _next);
              } else {
                next();
              }
            } else {
              next();
            }
          } catch (e) {
            err = e;
            next();
          }
        },
        () => {
          if (err) {
            reject(err);
          } else {
            resolve({
              statusCode: 404,
              body: 'Not Found',
            });
          }
        }
      );
    });
  };
  set(key, value) {
    this._settings[key] = value;
    return this;
  }
  get(...args) {
    return args.length === 1
      ? this._settings[args[0]]
      : this._addMiddleware('GET', false, ...args);
  }
}
function _getMatch(req, match) {
  let params = false;
  if (match === undefined) {
    params = {};
  } else if (!match?.method || req.method === match.method) {
    const regex_match = req.path.match(match.regex);
    if (regex_match) {
      params = regex_match.groups || {};
    }
  }
  return params;
}
function _makeMatch(path_list, method, is_prefix) {
  if (!Array.isArray(path_list)) {
    path_list = [path_list];
  }
  const parts = path_list.map((path) => _pathToRegexString(path, is_prefix));
  const regex = new RegExp(parts.join('|'));
  return { method, regex, is_prefix, source_list: path_list };
}
function _makeCombinedMatch(prefix_match, match) {
  const { source_list: prefix_source_list } = prefix_match || {};
  const { method, is_prefix, source_list } = match || {};
  let path_list = [];
  if (prefix_source_list && source_list?.length > 0) {
    prefix_source_list.forEach((prefix) => {
      source_list.forEach((source) => {
        path_list.push((prefix ?? '') + source);
      });
    });
  } else if (prefix_source_list) {
    path_list = prefix_source_list;
  } else {
    path_list = source_list;
  }
  return _makeMatch(path_list, method, is_prefix);
}
function _pathToRegexString(arg, is_prefix) {
  let ret;
  if (arg instanceof RegExp) {
    ret = arg.source;
  } else {
    const arg_params = arg.replace(/:([a-z0-9]*)/gi, '(?<$1>[^/]*)');
    ret = `^${arg_params}${is_prefix ? '' : '$'}`;
  }
  return ret;
}
function _cookiesToMap(cookies) {
  const ret = {};
  cookies?.forEach?.((cookie) => {
    const [key, ...values] = cookie.split('=');
    ret[key] = values.join('=');
  });
  return ret;
}

function _asyncForEach(list, callback, done) {
  let i = 0;
  function _asyncNext() {
    if (i < list.length) {
      callback(list[i++], (err) => {
        if (err) {
          done(err);
        } else {
          setImmediate(_asyncNext);
        }
      });
    } else {
      done();
    }
  }
  _asyncNext();
}
function _headerMatch(value, check) {
  return value?.indexOf?.(check) >= 0 ? check : false;
}
