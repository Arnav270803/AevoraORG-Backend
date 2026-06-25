import { HTTP_STATUS } from "../constants/http";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request.") {
    super(message, HTTP_STATUS.BAD_REQUEST);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized.") {
    super(message, HTTP_STATUS.UNAUTHORIZED);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, HTTP_STATUS.NOT_FOUND);
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "Not implemented.") {
    super(message, HTTP_STATUS.NOT_IMPLEMENTED);
  }
}
