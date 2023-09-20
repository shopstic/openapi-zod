// deno-lint-ignore-file no-explicit-any
import {
  CallbackObject,
  ComponentsObject,
  EncodingObject,
  ExampleObject,
  ExamplesObject,
  HeaderObject,
  HeadersObject,
  LinkObject,
  LinksObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecuritySchemeObject,
} from "./openapi/openapi.ts";
import type { ZodObject, ZodSchema, ZodType } from "./zod.ts";
import { ISpecificationExtension } from "./openapi/specification_extensions.ts";

type Method = "get" | "post" | "put" | "delete" | "patch";

export interface ZodMediaTypeObject {
  schema: ZodType<unknown> | SchemaObject | ReferenceObject;
  examples?: ExamplesObject;
  example?: any;
  encoding?: EncodingObject;
}

export interface ZodContentObject {
  [mediaType: string]: ZodMediaTypeObject;
}

export interface ZodRequestBody {
  description?: string;
  content: ZodContentObject;
  required?: boolean;
}

export interface ResponseConfig {
  description: string;
  headers?: HeadersObject;
  links?: LinksObject;
  content?: ZodContentObject;
}

export interface RouteConfig extends OperationObject {
  method: Method;
  path: string;
  request?: {
    body?: ZodRequestBody;
    params?: ZodObject<any>;
    query?: ZodObject<any>;
    headers?: ZodObject<any>;
  };
  responses: {
    [statusCode: string]: ResponseConfig;
  };
}

export type OpenapiComponentObject =
  | SchemaObject
  | ResponseObject
  | ParameterObject
  | ExampleObject
  | RequestBodyObject
  | HeaderObject
  | SecuritySchemeObject
  | LinkObject
  | CallbackObject
  | ISpecificationExtension;

export type ComponentTypeKey = Exclude<keyof ComponentsObject, number>;
export type ComponentTypeOf<K extends ComponentTypeKey> = NonNullable<
  ComponentsObject[K]
>[string];

export type OpenapiDefinitions =
  | {
    type: "component";
    componentType: ComponentTypeKey;
    name: string;
    component: OpenapiComponentObject;
  }
  | { type: "schema"; schema: ZodSchema<any> }
  | { type: "parameter"; schema: ZodSchema<any> }
  | { type: "route"; route: RouteConfig };

export class OpenapiRegistry {
  private _definitions: OpenapiDefinitions[] = [];

  constructor(private parents?: OpenapiRegistry[]) {}

  get definitions(): OpenapiDefinitions[] {
    const parentDefinitions = this.parents?.flatMap((par) => par.definitions) ??
      [];

    return [...parentDefinitions, ...this._definitions];
  }

  /**
   * Registers a new component schema under /components/schemas/${name}
   */
  register<T extends ZodSchema<any>>(refId: string, zodSchema: T) {
    const currentMetadata = zodSchema._def.openapi;
    const schemaWithMetadata = zodSchema.openapi({
      ...currentMetadata,
      refId,
    });

    this._definitions.push({ type: "schema", schema: schemaWithMetadata });

    return schemaWithMetadata;
  }

  /**
   * Registers a new parameter schema under /components/parameters/${name}
   */
  registerParameter<T extends ZodSchema<any>>(refId: string, zodSchema: T) {
    const currentMetadata = zodSchema._def.openapi;

    const schemaWithMetadata = zodSchema.openapi({
      ...currentMetadata,
      param: {
        ...currentMetadata?.param,
        name: currentMetadata?.param?.name ?? refId,
      },
      refId,
    });

    this._definitions.push({
      type: "parameter",
      schema: schemaWithMetadata,
    });

    return schemaWithMetadata;
  }

  /**
   * Registers a new path that would be generated under paths:
   */
  registerPath(route: RouteConfig) {
    this._definitions.push({
      type: "route",
      route,
    });
  }

  /**
   * Registers a raw Openapi component. Use this if you have a simple object instead of a Zod schema.
   *
   * @param type The component type, e.g. `schemas`, `responses`, `securitySchemes`, etc.
   * @param name The name of the object, it is the key under the component
   *             type in the resulting Openapi document
   * @param component The actual object to put there
   */
  registerComponent<K extends ComponentTypeKey>(
    type: K,
    name: string,
    component: ComponentTypeOf<K>,
  ) {
    this._definitions.push({
      type: "component",
      componentType: type,
      name,
      component,
    });

    return {
      name,
      ref: { $ref: `#/components/${String(type)}/${name}` },
    };
  }
}
