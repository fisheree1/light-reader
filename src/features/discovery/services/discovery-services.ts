import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { createNovelGateway } from '../../../platform/catalog/tauri-novel-gateway';
import { libraryServices } from '../../library/services/library-services';
import { BookDiscoveryService } from './book-discovery-service';
import { createOpdsGateway } from '../../../platform/catalog/tauri-opds-gateway';
import { OpdsService } from '../opds/opds-service';
import { createSyosetuGateway } from '../../../platform/catalog/tauri-syosetu-gateway';
import { SyosetuService } from '../syosetu/syosetu-service';
import { createBangumiGateway } from '../../../platform/catalog/tauri-bangumi-gateway';
import { BangumiService } from '../bangumi/bangumi-service';

async function createServices() {
  const gateway =
    import.meta.env.DEV && import.meta.env.VITE_DISCOVERY_FAKE_SOURCE === 'true'
      ? new (
          await import('../../../test/fixtures/novel-gateway')
        ).FixtureNovelGateway()
      : createNovelGateway();
  return new BookDiscoveryService(
    gateway,
    libraryServices.importer,
    new WebCryptoContentHasher(),
  );
}

async function createOpdsServices() {
  const gateway =
    import.meta.env.DEV && import.meta.env.VITE_DISCOVERY_FAKE_SOURCE === 'true'
      ? new (
          await import('../../../test/fixtures/opds-gateway')
        ).FixtureOpdsGateway()
      : createOpdsGateway();
  return new OpdsService(gateway, libraryServices.importer);
}

async function createSyosetuServices() {
  const gateway =
    import.meta.env.DEV && import.meta.env.VITE_DISCOVERY_FAKE_SOURCE === 'true'
      ? new (
          await import('../../../test/fixtures/syosetu-gateway')
        ).FixtureSyosetuGateway()
      : createSyosetuGateway();
  return new SyosetuService(
    gateway,
    libraryServices.importer,
    new WebCryptoContentHasher(),
  );
}

async function createBangumiServices() {
  const gateway =
    import.meta.env.DEV && import.meta.env.VITE_DISCOVERY_FAKE_SOURCE === 'true'
      ? new (
          await import('../../../test/fixtures/bangumi-gateway')
        ).FixtureBangumiGateway()
      : createBangumiGateway();
  return new BangumiService(gateway);
}

export const discoveryServices = createServices();
export const bangumiServices = createBangumiServices();
export const syosetuServices = createSyosetuServices();
export const opdsServices = createOpdsServices();
