import type { ProfileFileService } from '../services/ProfileFileService';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

export class ProfileMessageHandler {
  constructor(private fileService: ProfileFileService) {}

  async handle(
    message: Record<string, unknown>,
    respondFn: (msg: Record<string, unknown>) => void,
  ): Promise<boolean> {
    switch (message.type) {
      case 'profile:readIndex': {
        const index = await this.fileService.readIndex();
        respondFn({ type: 'profile:indexData', requestId: message.requestId, index });
        return true;
      }
      case 'profile:readProfile': {
        const data = await this.fileService.readProfile(message.id as string);
        respondFn({ type: 'profile:profileData', requestId: message.requestId, data });
        return true;
      }
      case 'profile:writeProfile':
        await this.fileService.writeProfile(message.id as string, message.data as ProfileData);
        return true;
      case 'profile:writeIndex':
        await this.fileService.writeIndex(message.index as ProfileIndex);
        return true;
      case 'profile:deleteProfile':
        await this.fileService.deleteProfile(message.id as string);
        return true;
      default:
        return false;
    }
  }
}
