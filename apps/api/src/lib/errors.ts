export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = "Not signed in.") => new HttpError(401, m);
export const forbidden = (m = "Your role does not permit this action.") => new HttpError(403, m);
export const notFound = (m = "Not found.") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
