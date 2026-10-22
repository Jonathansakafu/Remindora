import { applyDecorators, BadRequestException, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/** Validates and transforms input with a zod schema; failures become 400 with field details. */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'validation_failed',
        message: 'Request validation failed',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    return rest;
  } catch {
    return { type: 'object' };
  }
}

/** Documents a zod request body in OpenAPI. Pair with `@Body(new ZodPipe(schema))`. */
export function ApiZodBody(schema: ZodType, description?: string) {
  return applyDecorators(ApiBody({ schema: jsonSchema(schema) as never, description }));
}

/** Documents zod query parameters in OpenAPI. */
export function ApiZodQuery(schema: z.ZodObject) {
  const decorators = Object.entries(schema.shape).map(([name, field]) =>
    ApiQuery({ name, required: !(field as ZodType).safeParse(undefined).success, schema: jsonSchema(field as ZodType) as never }),
  );
  return applyDecorators(...decorators);
}

/** Query strings arrive as strings; these coerce common shapes before validation. */
export const q = {
  bool: () => z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean()),
  int: () => z.coerce.number().int(),
  list: <T extends ZodType>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item)),
};
