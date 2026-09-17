import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, User } from '../db/schema';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user,
);
