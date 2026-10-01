import { ApiError } from '../utils/errors.js';

export function requireRealm(realm) {
  return (req, _res, next) => {
    if (req.auth?.realm !== realm) {
      return next(new ApiError(403, 'This area is outside your account.', 'forbidden'));
    }
    next();
  };
}

export function requirePermission(...keys) {
  return (req, _res, next) => {
    if (req.auth?.supportAccess && !['GET', 'HEAD'].includes(req.method)) {
      return next(new ApiError(403, 'Support access is read only.', 'forbidden'));
    }
    const granted = new Set(req.auth?.permissions || []);
    if (!keys.every((key) => granted.has(key))) {
      return next(new ApiError(403, 'You do not have permission to do that.', 'forbidden'));
    }
    next();
  };
}

export function blockSupportWrites(req, _res, next) {
  if (req.auth?.supportAccess && !['GET', 'HEAD'].includes(req.method)) {
    return next(new ApiError(403, 'Support access is read only.', 'forbidden'));
  }
  next();
}
