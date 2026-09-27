import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CatalogService } from './catalog.service';
import { EventSearchDto } from './dto/event-search.dto';

@Public()
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('events')
  @ApiOperation({ summary: 'Search published events with upcoming shows' })
  @ApiOkResponse({ description: 'Paginated matching events and show summaries' })
  searchEvents(@Query() query: EventSearchDto) {
    return this.catalog.searchEvents(query);
  }

  @Get('events/:eventId')
  @ApiOperation({ summary: 'Get a published event and its upcoming shows' })
  @ApiOkResponse({ description: 'Event details' })
  @ApiNotFoundResponse({
    description: 'Event was not found or is not published',
    type: ErrorResponseDto,
  })
  getEvent(@Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.catalog.getEvent(eventId);
  }

  @Get('shows/:showId/seats')
  @ApiOperation({ summary: 'Get the current seat inventory for a published show' })
  @ApiOkResponse({ description: 'Show details, prices, and seat availability' })
  @ApiNotFoundResponse({ description: 'Show was not found', type: ErrorResponseDto })
  getShowSeats(@Param('showId', new ParseUUIDPipe()) showId: string) {
    return this.catalog.getShowSeats(showId);
  }
}
