import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { createNovelGateway } from '../../../platform/catalog/tauri-novel-gateway';
import { libraryServices } from '../../library/services/library-services';
import { BookDiscoveryService } from './book-discovery-service';
import { createOpdsGateway } from '../../../platform/catalog/tauri-opds-gateway';
import { OpdsService } from '../opds/opds-service';

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

export const discoveryServices = createServices();
export const opdsServices = createOpdsServices();
