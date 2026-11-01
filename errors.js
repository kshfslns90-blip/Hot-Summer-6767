// The error the authentication code answers with: a message for the person, a status for the
// route. On its own so that code with no database in sight (the seed file) can raise it.
export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
