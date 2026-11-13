/** Public integration settings. OAuth secrets and tokens live only in Nicolabz Identity. */
export const IDENTITY_APP_ID = 'batch-and-co';
export const IDENTITY_BASE_URL = location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://auth.nicolabz.dev';
