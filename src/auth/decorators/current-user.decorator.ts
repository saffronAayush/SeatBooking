import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtUser } from '../../common/types/jwt-user.type';

type AuthenticatedRequest = Request & { user: JwtUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
