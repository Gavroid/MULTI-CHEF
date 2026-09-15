// T21-C/T59-A: минимальный структурный JSON-логгер (без зависимостей).
// Уровни: info/warn/error. Корреляция — через jobId в полях.
type Level = 'info' | 'warn' | 'error';

export interface WorkerLogger {
  info(fields: Record<string, unknown> | string, msg?: string): void;
  warn(fields: Record<string, unknown> | string, msg?: string): void;
  error(fields: Record<string, unknown> | string, msg?: string): void;
}

export function createLogger(scope: string): WorkerLogger {
  const emit = (level: Level, fields: Record<string, unknown> | string, msg?: string): void => {
    const payload = typeof fields === 'string' ? { fields } : fields;
    process.stdout.write(
      `${JSON.stringify({ level, scope, time: new Date().toISOString(), ...payload, ...(msg ? { msg } : {}) })}\n`,
    );
  };
  return {
    info: (fields, msg) => emit('info', fields, msg),
    warn: (fields, msg) => emit('warn', fields, msg),
    error: (fields, msg) => emit('error', fields, msg),
  };
}
