import {
  OpenapiEndpoint,
  OpenapiEndpoints,
  OpenapiEndpointTypeBag,
  transformRecordToStringValues,
} from "./openapi_endpoint.ts";
import { ZodRouteConfig } from "./openapi_registry.ts";
import {
  ExcludeUndefinedValue,
  ExtractEndpointPaths,
  MaybeRecord,
  StripEmptyObjectType,
  TypedResponse,
} from "./types/shared.ts";
import { ZodError } from "./zod.ts";

interface OpenapiClientRequestContext<
  P extends MaybeRecord = MaybeRecord,
  Q extends MaybeRecord = MaybeRecord,
  H extends MaybeRecord = MaybeRecord,
  B = unknown,
> {
  params: P;
  query: Q;
  headers: H;
  body: B;
}

export class ClientResponse<S extends number = number, M extends string = string, D = unknown, H = unknown>
  implements TypedResponse<S, M, D, H> {
  readonly ok: boolean;

  constructor(
    readonly status: S,
    readonly mediaType: M,
    readonly data: D,
    readonly response: Response,
    readonly headers: H,
  ) {
    this.ok = response.ok;
  }
}

export class OpenapiClientUnexpectedResponseError extends Error {
  readonly name = OpenapiClientUnexpectedResponseError.name;
  constructor(readonly body: unknown, readonly response: Response) {
    super(`Received an unexpected response with status=${response.status} ${response.statusText}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OpenapiClientResponseHeaderValidationError extends Error {
  readonly name = OpenapiClientResponseHeaderValidationError.name;
  constructor(readonly headerName: string, readonly headerValue: string | null, readonly error: ZodError<unknown>) {
    super(`Header with name '${headerName}' and value '${headerValue}' failed schema validation`);
    Object.setPrototypeOf(this, new.target.prototype);
    Object.defineProperty(this, "message", {
      get() {
        return JSON.stringify(error.errors);
      },
      enumerable: false,
      configurable: false,
    });
  }
}

export class OpenapiClientResponseValidationError extends Error {
  readonly name = OpenapiClientResponseValidationError.name;
  constructor(readonly response: Response, readonly data: string, readonly error: ZodError<unknown>) {
    super(response.statusText);
    Object.setPrototypeOf(this, new.target.prototype);
    Object.defineProperty(this, "message", {
      get() {
        return JSON.stringify(error.errors);
      },
      enumerable: false,
      configurable: false,
    });
  }
}

type ExtractClientRequestArg<Bag> = Bag extends
  OpenapiEndpointTypeBag<infer P, infer Q, infer H, infer B, unknown, unknown, unknown>
  ? StripEmptyObjectType<ExcludeUndefinedValue<OpenapiClientRequestContext<P, Q, H, B>>>
  : undefined;

type ExtractClientResponseArg<Bag> = Bag extends
  OpenapiEndpointTypeBag<MaybeRecord, MaybeRecord, MaybeRecord, unknown, infer R, unknown, unknown>
  ? TypedResponseToClientResponse<R>
  : ClientResponse<number, string, unknown, HeadersInit>;

type TypedResponseToClientResponse<R> = R extends TypedResponse<infer S, infer M, infer D, infer H>
  ? ClientResponse<S, M, D, H>
  : never;

function renderPath(template: string, params?: Record<string, string>) {
  if (params) {
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
      if (!(key in params)) {
        throw new Error(
          `Expected path key ${key} doesnt exist in payload: ${JSON.stringify(params)}`,
        );
      }
      return encodeURIComponent(params[key]);
    });
  }

  return template;
}

const acceptHeaderValueByEndpointMap = new WeakMap<OpenapiEndpoint, string>();

function toStringValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toUrlSearchParams(query: Record<string, unknown>) {
  const params = Object.entries(query).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return value.map((v) => [key, toStringValue(v)]);
    }
    return [[key, toStringValue(value)]];
  });

  return new URLSearchParams(params);
}

async function openapiFetch({ baseUrl, pathTemplate, method, request, endpoint }: {
  baseUrl: string;
  pathTemplate: string;
  method: ZodRouteConfig["method"];
  request?: OpenapiClientRequestContext;
  endpoint: OpenapiEndpoint;
}): Promise<ClientResponse> {
  const requestParams = request?.params !== undefined ? transformRecordToStringValues(request.params) : undefined;
  const searchParams = request?.query !== undefined ? toUrlSearchParams(request.query) : undefined;
  const requestPath = requestParams ? renderPath(pathTemplate, requestParams) : pathTemplate;
  const requestUrl = new URL(
    `${baseUrl}${requestPath}${searchParams !== undefined ? `?${searchParams}` : ""}`,
  );
  const requestHeaders = new Headers(
    request?.headers !== undefined ? transformRecordToStringValues(request.headers) : undefined,
  );

  const requestBody = request?.body;

  if (requestBody !== undefined) {
    requestHeaders.set("content-type", "application/json");
  }

  const responseBodyMap = endpoint.response.body;

  if (responseBodyMap !== undefined) {
    let acceptHeaderValue = acceptHeaderValueByEndpointMap.get(endpoint);

    if (acceptHeaderValue === undefined) {
      acceptHeaderValue = Array.from(
        new Set(Array.from(responseBodyMap.values()).flatMap((m) => Array.from(m.keys()))),
      ).join(", ");
      acceptHeaderValueByEndpointMap.set(endpoint, acceptHeaderValue);
    }

    requestHeaders.set("accept", acceptHeaderValue);
  }

  const response = await fetch(requestUrl, {
    method: method.toUpperCase(),
    headers: requestHeaders,
    body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
  });

  const { status: responseStatus, headers: responseHeaders } = response;
  const responseContentType = response.headers.get("content-type");

  if (responseBodyMap === undefined) {
    return new ClientResponse(responseStatus, "", response.body, response, responseHeaders);
  }

  let responseBody;

  if (responseContentType === "application/json") {
    responseBody = await response.json();
  } else if (responseContentType?.startsWith("text/")) {
    responseBody = await response.text();
  } else {
    responseBody = response.body;
  }

  if (responseContentType === null) {
    throw new OpenapiClientUnexpectedResponseError(responseBody, response);
  }

  const schemas = responseBodyMap.get(responseStatus)?.get(responseContentType);

  if (schemas === undefined) {
    throw new OpenapiClientUnexpectedResponseError(responseBody, response);
  }

  const { body: responseBodySchema, headers: responseHeaderSchemas } = schemas;

  const validatedResponseHeaders = responseHeaderSchemas
    ? Object.fromEntries(
      responseHeaderSchemas.map(([headerName, headerSchema]) => {
        const headerValue = responseHeaders.get(headerName);
        const validation = headerSchema.safeParse(headerValue);

        if (validation.success) {
          return [headerName, validation.data];
        } else {
          throw new OpenapiClientResponseHeaderValidationError(headerName, headerValue, validation.error);
        }
      }),
    )
    : responseHeaders;

  if (responseBodySchema) {
    const validation = responseBodySchema.safeParse(responseBody);

    if (validation.success) {
      return new ClientResponse(
        responseStatus,
        responseContentType,
        validation.data,
        response,
        validatedResponseHeaders,
      );
    } else {
      throw new OpenapiClientResponseValidationError(response, responseBody, validation.error);
    }
  }

  return new ClientResponse(responseStatus, responseContentType, responseBody, response, responseHeaders);
}

export class OpenapiClient<R> {
  private endpoints: OpenapiEndpoints<R>;
  private baseUrl: string;

  constructor({ baseUrl, endpoints }: { baseUrl: string; endpoints: OpenapiEndpoints<R> }) {
    this.baseUrl = baseUrl;
    this.endpoints = endpoints;
  }

  endpoint<
    M extends ZodRouteConfig["method"],
    P extends string,
    Req extends OpenapiClientRequestContext<MaybeRecord, MaybeRecord, MaybeRecord, unknown>,
  >(method: M, path: P, request?: Req) {
    const endpoint = this.endpoints.get(path, method);

    if (!endpoint) {
      throw new Error(`Defect: no endpoint found for path=${path} method=${method}`);
    }

    return openapiFetch({
      baseUrl: this.baseUrl,
      pathTemplate: path,
      method,
      request,
      endpoint,
    });
  }

  get<
    E extends ExtractEndpointPaths<"get", R>,
    P extends Extract<keyof E, string>,
    Req extends ExtractClientRequestArg<E[P]>,
    Res extends ExtractClientResponseArg<E[P]>,
  >(path: P, request: Req) {
    return this.endpoint("get", path, request) as Promise<Res>;
  }

  post<
    E extends ExtractEndpointPaths<"post", R>,
    P extends Extract<keyof E, string>,
    Req extends ExtractClientRequestArg<E[P]>,
    Res extends ExtractClientResponseArg<E[P]>,
  >(path: P, request: Req) {
    return this.endpoint("post", path, request) as Promise<Res>;
  }

  put<
    E extends ExtractEndpointPaths<"put", R>,
    P extends Extract<keyof E, string>,
    Req extends ExtractClientRequestArg<E[P]>,
    Res extends ExtractClientResponseArg<E[P]>,
  >(path: P, request: Req) {
    return this.endpoint("put", path, request) as Promise<Res>;
  }

  patch<
    E extends ExtractEndpointPaths<"patch", R>,
    P extends Extract<keyof E, string>,
    Req extends ExtractClientRequestArg<E[P]>,
    Res extends ExtractClientResponseArg<E[P]>,
  >(path: P, request: Req) {
    return this.endpoint("patch", path, request) as Promise<Res>;
  }

  delete<
    E extends ExtractEndpointPaths<"delete", R>,
    P extends Extract<keyof E, string>,
    Req extends ExtractClientRequestArg<E[P]>,
    Res extends ExtractClientResponseArg<E[P]>,
  >(path: P, request: Req) {
    return this.endpoint("delete", path, request) as Promise<Res>;
  }
}
