import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import courseSchema from '../schema/course.schema.json';
import holesSchema from '../schema/holes.schema.json';
import pathsSchema from '../schema/paths.schema.json';
import type { CourseJson, HolesJson, PathsJson } from './index';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const courseValidator = ajv.compile<CourseJson>(courseSchema);
const holesValidator = ajv.compile<HolesJson>(holesSchema);
const pathsValidator = ajv.compile<PathsJson>(pathsSchema);

export class PacketValidationError extends Error {
  constructor(
    readonly file: string,
    readonly errors: ErrorObject[],
  ) {
    super(`${file} failed schema validation: ${ajv.errorsText(errors, { dataVar: file })}`);
    this.name = 'PacketValidationError';
  }
}

function check<T>(file: string, validate: ValidateFunction<T>, data: unknown): T {
  if (!validate(data)) throw new PacketValidationError(file, validate.errors ?? []);
  return data;
}

export const validateCourse = (data: unknown): CourseJson => check('course.json', courseValidator, data);
export const validateHoles = (data: unknown): HolesJson => check('holes.json', holesValidator, data);
export const validatePaths = (data: unknown): PathsJson => check('paths.json', pathsValidator, data);

export { courseSchema, holesSchema, pathsSchema };
