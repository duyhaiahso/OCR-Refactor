import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DongleCheckerService } from './dongle-checker.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SystemController],
  providers: [SystemService, DongleCheckerService, JwtAuthGuard],
  exports: [SystemService],
})
export class SystemModule {}
