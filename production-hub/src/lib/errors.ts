export class AuthError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "AuthError";
  }
}
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}
/** Also used when a sub asks for something that isn't theirs, so they can't tell it exists. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
