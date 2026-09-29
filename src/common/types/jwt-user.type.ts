import { UserRole } from '../../generated/prisma/client';

export interface JwtUser {
  id: string;
  email: string;
  roles: UserRole[];
}

export interface JwtPayload {
  sub: string;
  email: string;
  roles: UserRole[];
  jti?: string;
  familyId?: string;
}
