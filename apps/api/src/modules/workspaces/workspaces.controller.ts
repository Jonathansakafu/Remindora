import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessService } from '../../common/access.service';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { ActivityService } from '../activity/activity.service';
import { WorkspacesService } from './workspaces.service';

const nameInput = z.object({ name: z.string().trim().min(1).max(80) });
const roleInput = z.object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']) });
const inviteInput = z.object({ email: z.email().transform((e) => e.toLowerCase()), role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER') });
const acceptInput = z.object({ token: z.string().min(20).max(200) });
const folderUpdate = z.object({ name: z.string().trim().min(1).max(80), sortOrder: z.number() }).partial();

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller()
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly activity: ActivityService,
    private readonly access: AccessService,
  ) {}

  @Get('workspaces')
  list(@Auth() a: AuthContext) {
    return this.workspaces.list(a.userId);
  }

  @Post('workspaces')
  @ApiOperation({ summary: 'Create a shared workspace' })
  @ApiZodBody(nameInput)
  create(@Auth() a: AuthContext, @Body(new ZodPipe(nameInput)) body: z.infer<typeof nameInput>) {
    return this.workspaces.create(a.userId, body.name);
  }

  @Patch('workspaces/:id')
  @ApiZodBody(nameInput)
  update(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nameInput)) body: z.infer<typeof nameInput>) {
    return this.workspaces.update(a.userId, id, body.name);
  }

  @Delete('workspaces/:id')
  remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.remove(a.userId, id);
  }

  @Get('workspaces/:id/members')
  members(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.members(a.userId, id);
  }

  @Patch('workspaces/:id/members/:userId')
  @ApiOperation({ summary: 'Change a member role (owner/admin rules enforced)' })
  @ApiZodBody(roleInput)
  role(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(roleInput)) body: z.infer<typeof roleInput>) {
    return this.workspaces.changeRole(a.userId, id, userId, body.role);
  }

  @Delete('workspaces/:id/members/:userId')
  removeMember(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.workspaces.removeMember(a.userId, id, userId);
  }

  @Post('workspaces/:id/invites')
  @ApiOperation({ summary: 'Invite by email (counts against the owner’s member limit)' })
  @ApiZodBody(inviteInput)
  invite(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(inviteInput)) body: z.infer<typeof inviteInput>) {
    return this.workspaces.invite(a.userId, id, body.email, body.role);
  }

  @Get('workspaces/:id/invites')
  invites(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.invites(a.userId, id);
  }

  @Delete('workspaces/:id/invites/:inviteId')
  revokeInvite(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.workspaces.revokeInvite(a.userId, id, inviteId);
  }

  @Post('invites/accept')
  @HttpCode(200)
  @ApiZodBody(acceptInput)
  accept(@Auth() a: AuthContext, @Body(new ZodPipe(acceptInput)) body: z.infer<typeof acceptInput>) {
    return this.workspaces.accept(a.userId, body.token);
  }

  @Post('invites/:id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invite from the in-app notification (email must match)' })
  acceptById(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.acceptById(a.userId, id);
  }

  @Get('workspaces/:id/audit')
  @ApiOperation({ summary: 'Security audit log (owners/admins)' })
  audit(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return this.workspaces.auditLog(a.userId, id, Number(limit) || 100);
  }

  @Get('workspaces/:id/activity')
  async activityFeed(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.workspace(a.userId, id, 'workspace.read');
    return this.activity.list(a.userId, { workspaceId: id });
  }

  @Get('workspaces/:id/folders')
  folders(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.folders(a.userId, id);
  }

  @Post('workspaces/:id/folders')
  @ApiZodBody(nameInput)
  createFolder(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nameInput)) body: z.infer<typeof nameInput>) {
    return this.workspaces.createFolder(a.userId, id, body.name);
  }

  @Patch('folders/:id')
  @ApiZodBody(folderUpdate)
  updateFolder(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(folderUpdate)) body: z.infer<typeof folderUpdate>) {
    return this.workspaces.updateFolder(a.userId, id, body);
  }

  @Delete('folders/:id')
  deleteFolder(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.deleteFolder(a.userId, id);
  }
}
