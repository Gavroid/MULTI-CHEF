// T39-D (audit round 39): ThrottlerException раньше уходил через
// default NestJS-рендер с сырым "ThrottlerException: …". Этот фильтр
// отдаёт наш RATE_LIMITED-конверт и Retry-After.
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

@Catch()
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const isThrottler =
      exception instanceof HttpException && exception.getStatus() === HttpStatus.TOO_MANY_REQUESTS;

    if (!isThrottler) throw exception;

    const body = {
      status: HttpStatus.TOO_MANY_REQUESTS,
      error: {
        code: 'RATE_LIMITED',
        message: 'Слишком много запросов — попробуйте позже',
      },
    };
    response
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .header('Retry-After', '10')
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(body);
  }
}
