import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @ApiOperation({ summary: 'Check license status before login' })
  @Get('license/public')
  getPublicLicenseStatus() {
    return this.systemService.checkLicenseStatus({ persist: false });
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current license status' })
  @Get('license')
  @UseGuards(JwtAuthGuard)
  getLicenseStatus() {
    return this.systemService.checkLicenseStatus();
  }
}
