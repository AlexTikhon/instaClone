import { Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import {
  notificationsQuerySchema,
  socialUserIdSchema,
  type MarkAllNotificationsReadResponse,
  type NotificationResponse,
  type NotificationsResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @UseGuards(AccessAuthGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<NotificationsResponse> {
    return this.notifications.list(
      request.identity.id,
      parseRequest(notificationsQuerySchema, query),
    );
  }

  @Put('read-all')
  @UseGuards(AccessAuthGuard, CsrfGuard)
  markAllRead(@Req() request: AuthenticatedRequest): Promise<MarkAllNotificationsReadResponse> {
    return this.notifications.markAllRead(request.identity.id);
  }

  @Put(':notificationId/read')
  @UseGuards(AccessAuthGuard, CsrfGuard)
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(
      request.identity.id,
      parseRequest(socialUserIdSchema, notificationId),
    );
  }
}
