// src/ApolloClient.js
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { isPageHidden } from './utils/pageVisibility';

const graphqlUri =
  process.env.REACT_APP_GRAPHQL_HTTP_URL || 'http://localhost:8000/graphql';

const httpLink = new HttpLink({
  uri: graphqlUri,
});

const authLink = setContext((_, { headers }) => {
  return {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    }
  };
});

const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
  defaultOptions: {
    // Applies to every polling useQuery: skip polls while the window is hidden/minimized.
    watchQuery: { skipPollAttempt: isPageHidden },
  },
});

export default client;
