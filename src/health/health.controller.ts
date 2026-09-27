import { Controller, Get } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LivenessResponseDto, ReadinessResponseDto } from './dto/health-response.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Process liveness check' })
  @ApiOkResponse({ description: 'Process is alive', type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Database readiness check' })
  @ApiOkResponse({ description: 'Application and database are ready', type: ReadinessResponseDto })
  @ApiInternalServerErrorResponse({
    description: 'Database is unreachable or an unexpected server error occurred',
    type: ErrorResponseDto,
  })
  async ready(): Promise<ReadinessResponseDto> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'reachable', timestamp: new Date().toISOString() };
  }
}
