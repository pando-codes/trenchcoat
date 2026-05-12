export interface ServiceError {
  code: string;
  message: string;
  details?: unknown;
}

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: ServiceError };
