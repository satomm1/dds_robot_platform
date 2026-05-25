export function getGraphqlHttpUrl() {
  return process.env.REACT_APP_GRAPHQL_HTTP_URL || 'http://localhost:8000/graphql';
}

/** Origin + path prefix for REST health routes (/health, /ready). */
export function getGraphqlBaseUrl() {
  const uri = getGraphqlHttpUrl();
  return uri.replace(/\/graphql\/?$/i, '');
}
