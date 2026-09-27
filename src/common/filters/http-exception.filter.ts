import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponseDto } from '../dto/error-response.dto';

type RequestWithId = Request & { id: string };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const reply = context.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;

    let message: string | string[] = 'Internal server error';
    let error = HttpStatus[status] ?? 'Error';

    if (typeof response === 'string') {
      message = response;
    } else if (response && typeof response === 'object') {
      const details = response as { message?: string | string[]; error?: string };
      message = details.message ?? message;
      error = details.error ?? error;
    }

    const body: ErrorResponseDto = {
      statusCode: status,
      error,
      message,
      path: request.url,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };

    reply.status(status).json(body);
  }
}
