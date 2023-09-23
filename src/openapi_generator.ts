// deno-lint-ignore-file no-explicit-any
import {
  ComponentsObject,
  ContentObject,
  ExternalDocumentationObject,
  HeadersObject,
  InfoObject,
  OpenapiObject,
  ParameterLocation,
  ParameterObject,
  PathItemObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecurityRequirementObject,
  ServerObject,
  TagObject,
} from "./openapi/openapi.ts";
import type {
  ZodObject,
  ZodOpenapiMetadata,
  ZodRawShape,
  ZodSchema,
  ZodString,
  ZodStringDef,
  ZodType,
  ZodTypeAny,
} from "./zod.ts";
import { compact, isNil, mapValues, objectEquals, omit, omitBy } from "./lib/lodash.ts";
import {
  OpenapiComponentObject,
  OpenapiDefinitions,
  ZodContentObject,
  ZodRequestBody,
  ZodResponseConfig,
  ZodResponseHeadersObject,
  ZodRouteConfig,
} from "./openapi_registry.ts";
import { ConflictError, MissingParameterDataError, UnknownZodTypeError } from "./errors.ts";
import { isAnyZodType, isZodType } from "./lib/zod-is-type.ts";

// See https://github.com/colinhacks/zod/blob/9eb7eb136f3e702e86f030e6984ef20d4d8521b6/src/types.ts#L1370
type UnknownKeysParam = "passthrough" | "strict" | "strip";

// This is essentially OpenapiObject without the components and paths keys.
// Omit does not work, since OpenapiObject extends ISpecificationExtension
// and is inferred as { [key: number]: any; [key: string]: any }
interface OpenapiObjectConfig {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  security?: SecurityRequirementObject[];
  tags?: TagObject[];
  externalDocs?: ExternalDocumentationObject;

  // Allow for specification extension keys
  [key: string]: unknown;
}

interface ParameterData {
  in?: ParameterLocation;
  name?: string;
}

export class OpenapiGenerator {
  private schemaRefs: Record<string, SchemaObject> = {};
  private paramRefs: Record<string, ParameterObject> = {};
  private pathRefs: Record<string, Record<string, PathsObject>> = {};
  private rawComponents: {
    componentType: string;
    name: string;
    component: OpenapiComponentObject;
  }[] = [];

  constructor(private definitions: OpenapiDefinitions[]) {
    this.sortDefinitions();
  }

  generateDocument(config: OpenapiObjectConfig): OpenapiObject {
    this.definitions.forEach((definition) => this.generateSingle(definition));

    return {
      ...config,
      components: this.buildComponents(),
      paths: this.pathRefs,
    };
  }

  private buildComponents() {
    const rawComponents: ComponentsObject = {};
    this.rawComponents.forEach(({ componentType, name, component }) => {
      // @ts-ignore suppress
      rawComponents[componentType] ??= {};
      // @ts-ignore suppress
      rawComponents[componentType][name] = component;
    });

    return {
      ...rawComponents,

      schemas: {
        ...(rawComponents.schemas ?? {}),
        ...this.schemaRefs,
      },

      parameters: {
        ...(rawComponents.parameters ?? {}),
        ...this.paramRefs,
      },
    };
  }

  private sortDefinitions() {
    const generationOrder: OpenapiDefinitions["type"][] = [
      "schema",
      "parameter",
      "route",
    ];

    this.definitions.sort((left, right) => {
      const leftIndex = generationOrder.findIndex((type) => type === left.type);
      const rightIndex = generationOrder.findIndex((type) => type === right.type);

      return leftIndex - rightIndex;
    });
  }

  private generateSingle(definition: OpenapiDefinitions): void {
    switch (definition.type) {
      case "parameter":
        this.generateParameterDefinition(definition.schema);
        return;

      case "schema":
        this.generateSchemaDefinition(definition.schema);
        return;

      case "route":
        this.generateSingleRoute(definition.route);
        return;

      case "component":
        this.rawComponents.push(definition);
        return;
    }
  }

  private generateParameterDefinition(
    zodSchema: ZodSchema<any>,
  ): ParameterObject | ReferenceObject {
    const metadata = this.getMetadata(zodSchema);

    const result = this.generateParameter(zodSchema);

    if (metadata?.refId) {
      this.paramRefs[metadata.refId] = result;
    }

    return result;
  }

  private getParameterRef(
    schemaMetadata: ZodOpenapiMetadata | undefined,
    external?: ParameterData,
  ): ReferenceObject | undefined {
    const parameterMetadata = schemaMetadata?.param;

    const existingRef = schemaMetadata?.refId ? this.paramRefs[schemaMetadata.refId] : undefined;

    if (!schemaMetadata?.refId || !existingRef) {
      return undefined;
    }

    if (
      (parameterMetadata && existingRef.in !== parameterMetadata.in) ||
      (external?.in && existingRef.in !== external.in)
    ) {
      throw new ConflictError(
        `Conflicting location for parameter ${existingRef.name}`,
        {
          key: "in",
          values: compact([
            existingRef.in,
            external?.in,
            parameterMetadata?.in,
          ]),
        },
      );
    }

    if (
      (parameterMetadata && existingRef.name !== parameterMetadata.name) ||
      (external?.name && existingRef.name !== external?.name)
    ) {
      throw new ConflictError(`Conflicting names for parameter`, {
        key: "name",
        values: compact([
          existingRef.name,
          external?.name,
          parameterMetadata?.name,
        ]),
      });
    }

    return {
      $ref: `#/components/parameters/${schemaMetadata.refId}`,
    };
  }

  private generateInlineParameters(
    params: Record<string, ZodType>,
    location: ParameterLocation,
  ): (ParameterObject | ReferenceObject)[] {
    return Object.entries(params).map(([key, schema]) => {
      const innerMetadata = this.getMetadata(schema);

      const referencedSchema = this.getParameterRef(innerMetadata, {
        in: location,
        name: key,
      });

      if (referencedSchema) {
        return referencedSchema;
      }

      const innerParameterMetadata = innerMetadata?.param;

      if (
        innerParameterMetadata?.name &&
        innerParameterMetadata.name !== key
      ) {
        throw new ConflictError(`Conflicting names for parameter`, {
          key: "name",
          values: [key, innerParameterMetadata.name],
        });
      }

      if (
        innerParameterMetadata?.in &&
        innerParameterMetadata.in !== location
      ) {
        throw new ConflictError(
          `Conflicting location for parameter ${innerParameterMetadata.name ?? key}`,
          {
            key: "in",
            values: [location, innerParameterMetadata.in],
          },
        );
      }

      return this.generateParameter(
        schema.openapi({ param: { name: key, in: location } }),
      );
    });
  }

  private generateParameter(zodSchema: ZodSchema<any>): ParameterObject {
    const metadata = this.getMetadata(zodSchema);

    const paramMetadata = metadata?.param;

    const paramName = paramMetadata?.name;
    const paramLocation = paramMetadata?.in;

    if (!paramName) {
      throw new MissingParameterDataError({ missingField: "name" });
    }

    if (!paramLocation) {
      throw new MissingParameterDataError({
        missingField: "in",
        paramName,
      });
    }

    const required = !zodSchema.isOptional() && !zodSchema.isNullable();

    const schema = this.generateSimpleSchema(zodSchema);

    return {
      in: paramLocation,
      name: paramName,
      schema,
      required,
      ...metadata.description ? { description: metadata.description } : {},
      ...(paramMetadata ? this.buildParameterMetadata(paramMetadata) : {}),
    };
  }

  /**
   * Generates an Openapi SchemaObject or a ReferenceObject with all the provided metadata applied
   */
  private generateSimpleSchema(
    zodSchema: ZodSchema<any>,
  ): SchemaObject | ReferenceObject {
    const innerSchema = this.unwrapChained(zodSchema);
    const metadata = zodSchema._def.openapi ? zodSchema._def.openapi : innerSchema._def.openapi;

    const refId = metadata?.refId;

    if (refId && this.schemaRefs[refId]) {
      const referenceObject = {
        $ref: `#/components/schemas/${refId}`,
      };

      const nullableMetadata = zodSchema.isNullable() ? { nullable: true } : {};

      const appliedMetadata = this.applySchemaMetadata(
        nullableMetadata,
        metadata,
      );

      if (Object.keys(appliedMetadata).length > 0) {
        return {
          allOf: [referenceObject, appliedMetadata],
        };
      }

      return referenceObject;
    }

    const result = metadata?.type
      ? {
        type: metadata?.type,
      }
      : this.toOpenapiSchema(innerSchema, zodSchema.isNullable());

    return metadata ? this.applySchemaMetadata(result, metadata) : omitBy(result as Record<string, unknown>, isNil);
  }

  private generateInnerSchema(
    zodSchema: ZodSchema<any>,
    metadata?: ZodOpenapiMetadata,
  ): SchemaObject | ReferenceObject {
    const simpleSchema = this.generateSimpleSchema(zodSchema);

    // @ts-ignore suppress
    if (simpleSchema.$ref) {
      return simpleSchema;
    }

    return metadata
      // @ts-ignore suppress
      ? this.applySchemaMetadata(simpleSchema, metadata)
      : simpleSchema;
  }

  private generateSchemaDefinition(zodSchema: ZodSchema<any>): SchemaObject {
    const metadata = this.getMetadata(zodSchema);
    const refId = metadata?.refId;

    const simpleSchema = this.generateSimpleSchema(zodSchema);

    const result = metadata
      // @ts-ignore suppress
      ? this.applySchemaMetadata(simpleSchema, metadata)
      : simpleSchema;

    if (refId) {
      // @ts-ignore suppress
      this.schemaRefs[refId] = result;
    }

    // @ts-ignore suppress
    return result;
  }

  private getRequestBody(
    requestBody: ZodRequestBody | undefined,
  ): RequestBodyObject | undefined {
    if (!requestBody) {
      return;
    }

    const { content: _, ...rest } = requestBody;

    const requestBodyContent = this.getBodyContent(requestBody.content);

    return {
      ...rest,
      content: requestBodyContent,
    };
  }

  private getParameters(
    request: ZodRouteConfig["request"] | undefined,
  ): (ParameterObject | ReferenceObject)[] {
    if (!request) {
      return [];
    }

    const queryParameters = request.query ? this.generateInlineParameters(request.query, "query") : [];

    const pathParameters = request.params ? this.generateInlineParameters(request.params, "path") : [];

    const headerParameters = request.headers ? this.generateInlineParameters(request.headers, "header") : [];

    return [...pathParameters, ...queryParameters, ...headerParameters];
  }

  private generateSingleRoute(route: ZodRouteConfig) {
    const { method, path, request, responses, ...pathItemConfig } = route;

    const generatedResponses = mapValues(responses, (response) => {
      return this.getResponse(response);
    });

    const parameters = this.getParameters(request);
    const requestBody = this.getRequestBody(request?.body);

    const routeDoc: PathItemObject = {
      [method]: {
        ...pathItemConfig,

        ...(parameters.length > 0 ? { parameters } : {}),

        ...(requestBody ? { requestBody } : {}),

        responses: generatedResponses,
      },
    };

    // @ts-ignore suppress
    this.pathRefs[path] = {
      ...this.pathRefs[path],
      ...routeDoc,
    };

    return routeDoc;
  }

  private getResponse({
    content,
    headers,
    ...rest
  }: ZodResponseConfig): ResponseObject | ReferenceObject {
    const responseContent = content ? { content: this.getBodyContent(content) } : {};
    const responseHeaders = headers ? { headers: this.getResponseHeaders(headers) } : {};

    return {
      ...rest,
      ...responseContent,
      ...responseHeaders,
    };
  }

  private getResponseHeaders(headers: ZodResponseHeadersObject): HeadersObject {
    return mapValues(headers, (config) => {
      if (!isAnyZodType(config.schema)) {
        return config;
      }

      const schema = this.generateInnerSchema(config.schema);

      return { ...config, schema };
    });
  }

  private getBodyContent(content: ZodContentObject): ContentObject {
    return mapValues(content, (config) => {
      if (!isAnyZodType(config.schema)) {
        return { schema: config.schema };
      }

      const schema = this.generateSimpleSchema(config.schema);

      return { schema };
    });
  }

  private getZodStringCheck<T extends ZodStringDef["checks"][number]["kind"]>(
    zodString: ZodString,
    kind: T,
  ) {
    return zodString._def.checks.find(
      (
        check,
      ): check is Extract<
        ZodStringDef["checks"][number],
        { kind: typeof kind }
      > => {
        return check.kind === kind;
      },
    );
  }

  /**
   * Attempts to map Zod strings to known formats
   * https://json-schema.org/understanding-json-schema/reference/string.html#built-in-formats
   */
  private mapStringFormat(zodString: ZodString): string | undefined {
    if (zodString.isUUID) {
      return "uuid";
    }

    if (zodString.isEmail) {
      return "email";
    }

    if (zodString.isURL) {
      return "uri";
    }

    return undefined;
  }

  private toOpenapiSchema(
    zodSchema: ZodSchema<any>,
    isNullable: boolean,
  ): SchemaObject {
    if (isZodType(zodSchema, "ZodNull")) {
      return { type: "null" };
    }

    if (isZodType(zodSchema, "ZodString")) {
      const regexCheck = this.getZodStringCheck(zodSchema, "regex");
      return {
        type: "string",
        nullable: isNullable ? true : undefined,
        format: this.mapStringFormat(zodSchema),
        pattern: regexCheck?.regex.source,
      };
    }

    if (isZodType(zodSchema, "ZodNumber")) {
      return {
        type: zodSchema.isInt ? "integer" : "number",
        minimum: zodSchema.minValue ?? undefined,
        maximum: zodSchema.maxValue ?? undefined,
        nullable: isNullable ? true : undefined,
      };
    }

    if (isZodType(zodSchema, "ZodBoolean")) {
      return {
        type: "boolean",
        nullable: isNullable ? true : undefined,
      };
    }

    if (isZodType(zodSchema, "ZodDefault")) {
      const innerSchema = zodSchema._def.innerType as ZodSchema<any>;
      // @ts-ignore suppress
      return this.generateInnerSchema(innerSchema);
    }

    if (
      isZodType(zodSchema, "ZodEffects") &&
      (zodSchema._def.effect.type === "refinement" ||
        zodSchema._def.effect.type === "preprocess")
    ) {
      const innerSchema = zodSchema._def.schema as ZodSchema<any>;
      // @ts-ignore suppress
      return this.generateInnerSchema(innerSchema);
    }

    if (isZodType(zodSchema, "ZodLiteral")) {
      return {
        type: typeof zodSchema._def.value as SchemaObject["type"],
        nullable: isNullable ? true : undefined,
        enum: [zodSchema._def.value],
      };
    }

    if (isZodType(zodSchema, "ZodEnum")) {
      // ZodEnum only accepts strings
      return {
        type: "string",
        nullable: isNullable ? true : undefined,
        enum: zodSchema._def.values,
      };
    }

    if (isZodType(zodSchema, "ZodNativeEnum")) {
      const enumValues = Object.values(zodSchema._def.values);

      // ZodNativeEnum can accepts number values for enum but in odd format
      // Not worth it for now so using plain string
      return {
        type: "string",
        nullable: isNullable ? true : undefined,
        enum: enumValues,
      };
    }

    if (isZodType(zodSchema, "ZodObject")) {
      return this.toOpenapiObjectSchema(zodSchema, isNullable);
    }

    if (isZodType(zodSchema, "ZodArray")) {
      const itemType = zodSchema._def.type as ZodSchema<any>;

      return {
        type: "array",
        items: this.generateInnerSchema(itemType),

        minItems: zodSchema._def.minLength?.value,
        maxItems: zodSchema._def.maxLength?.value,
      };
    }

    if (isZodType(zodSchema, "ZodUnion")) {
      const options = this.flattenUnionTypes(zodSchema);

      return {
        anyOf: options.map((schema) => this.generateInnerSchema(schema)),
      };
    }

    if (isZodType(zodSchema, "ZodDiscriminatedUnion")) {
      const options = [...zodSchema.options.values()];

      return {
        oneOf: options.map((schema) => this.generateInnerSchema(schema)),
        discriminator: {
          propertyName: zodSchema._def.discriminator,
        },
      };
    }

    if (isZodType(zodSchema, "ZodIntersection")) {
      const subtypes = this.flattenIntersectionTypes(zodSchema);

      return {
        allOf: subtypes.map((schema) => this.generateInnerSchema(schema)),
      };
    }

    if (isZodType(zodSchema, "ZodRecord")) {
      const propertiesType = zodSchema._def.valueType;

      return {
        type: "object",
        additionalProperties: this.generateInnerSchema(propertiesType),
      };
    }

    if (isZodType(zodSchema, "ZodUnknown")) {
      return {};
    }

    const refId = this.getMetadata(zodSchema)?.refId;

    throw new UnknownZodTypeError({
      currentSchema: zodSchema._def,
      schemaName: refId,
    });
  }

  private isOptionalSchema(zodSchema: ZodTypeAny): boolean {
    if (isZodType(zodSchema, "ZodEffects")) {
      return this.isOptionalSchema(zodSchema._def.schema);
    }

    if (isZodType(zodSchema, "ZodDefault")) {
      return this.isOptionalSchema(zodSchema._def.innerType);
    }

    return zodSchema.isOptional();
  }

  private toOpenapiObjectSchema(
    zodSchema: ZodObject<ZodRawShape>,
    isNullable: boolean,
  ): SchemaObject {
    const extendedFrom = zodSchema._def.openapi?.extendedFrom;

    const propTypes = zodSchema._def.shape();
    // @ts-ignore suppress
    const unknownKeysOption = zodSchema._unknownKeys as UnknownKeysParam;

    const requiredProperties = Object.entries(propTypes)
      .filter(([_key, type]) => !this.isOptionalSchema(type))
      .map(([key, _type]) => key);

    const schemaProperties = mapValues(
      propTypes,
      (propSchema) => this.generateInnerSchema(propSchema),
    );

    let alreadyRegistered: string[] = [];
    let alreadyRequired: string[] = [];

    if (extendedFrom) {
      const registeredSchema = this.schemaRefs[extendedFrom];

      if (!registeredSchema) {
        throw new Error(
          `Attempt to extend an unregistered schema with id ${extendedFrom}.`,
        );
      }

      const registeredProperties = registeredSchema.properties ?? {};

      alreadyRegistered = Object.keys(registeredProperties).filter(
        (propKey) => {
          return objectEquals(
            schemaProperties[propKey],
            registeredProperties[propKey],
          );
        },
      );

      alreadyRequired = registeredSchema.required ?? [];
    }

    const properties = omit(schemaProperties, alreadyRegistered);

    const additionallyRequired = requiredProperties.filter(
      (prop) => !alreadyRequired.includes(prop),
    );

    const objectData = {
      type: "object" as const,

      properties,

      ...(isNullable ? { nullable: true } : {}),

      ...(additionallyRequired.length > 0 ? { required: additionallyRequired } : {}),

      ...(unknownKeysOption === "passthrough" ? { additionalProperties: true } : {}),
    };

    if (extendedFrom) {
      return {
        allOf: [{ $ref: `#/components/schemas/${extendedFrom}` }, objectData],
      };
    }

    return objectData;
  }

  private flattenUnionTypes(schema: ZodSchema<any>): ZodSchema<any>[] {
    if (!isZodType(schema, "ZodUnion")) {
      return [schema];
    }

    const options = schema._def.options as ZodSchema<any>[];

    return options.flatMap((option) => this.flattenUnionTypes(option));
  }

  private flattenIntersectionTypes(schema: ZodSchema<any>): ZodSchema<any>[] {
    if (!isZodType(schema, "ZodIntersection")) {
      return [schema];
    }

    const leftSubTypes = this.flattenIntersectionTypes(schema._def.left);
    const rightSubTypes = this.flattenIntersectionTypes(schema._def.right);

    return [...leftSubTypes, ...rightSubTypes];
  }

  private unwrapChained(schema: ZodSchema<any>): ZodSchema<any> {
    if (isZodType(schema, "ZodOptional") || isZodType(schema, "ZodNullable")) {
      return this.unwrapChained(schema.unwrap());
    }

    if (isZodType(schema, "ZodDefault")) {
      return this.unwrapChained(schema._def.innerType);
    }

    if (
      isZodType(schema, "ZodEffects") &&
      schema._def.effect.type === "refinement"
    ) {
      return this.unwrapChained(schema._def.schema);
    }

    return schema;
  }

  private buildSchemaMetadata(metadata: ZodOpenapiMetadata) {
    // A place to omit all custom keys added to the openapi
    // @ts-ignore suppress
    return omitBy(omit(metadata, ["param", "refId", "extendedFrom"]), isNil);
  }

  private buildParameterMetadata(
    metadata: Required<ZodOpenapiMetadata>["param"],
  ) {
    return omitBy(metadata, isNil);
  }

  private getMetadata(zodSchema: ZodSchema<any>) {
    const innerSchema = this.unwrapChained(zodSchema);
    const metadata = zodSchema._def.openapi ?? innerSchema._def.openapi;
    const description = zodSchema._def.description ?? innerSchema._def.description;

    return {
      description,
      ...metadata,
    };
  }

  private applySchemaMetadata(
    initialData: SchemaObject | ParameterObject,
    metadata: Partial<ZodOpenapiMetadata>,
  ): SchemaObject | ReferenceObject {
    return omitBy(
      {
        ...initialData,
        ...this.buildSchemaMetadata(metadata),
      },
      isNil,
    );
  }
}
