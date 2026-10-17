import { useOpdsCatalogs } from './opds-catalog-store';

describe('OPDS catalog list', () => {
  beforeEach(() => {
    useOpdsCatalogs.setState({ catalogs: [] });
  });

  it('adds valid unique catalogs and removes them', () => {
    const { add } = useOpdsCatalogs.getState();
    const added = add(' 家里 ', 'http://192.168.1.20:8083/opds');
    expect(added).toMatchObject({
      title: '家里',
      url: 'http://192.168.1.20:8083/opds',
    });
    expect(add('again', 'http://192.168.1.20:8083/opds')).toBeNull();
    expect(add('', 'https://example.org/opds')?.title).toBe(
      'https://example.org/opds',
    );
    for (const url of [
      'ftp://example.org/opds',
      'https://user:pw@example.org/opds',
      'not a url',
    ])
      expect(add('x', url)).toBeNull();
    useOpdsCatalogs.getState().remove(added?.id ?? '');
    expect(useOpdsCatalogs.getState().catalogs.map((item) => item.url)).toEqual(
      ['https://example.org/opds'],
    );
  });

  it('drops a corrupted saved list instead of failing', async () => {
    localStorage.setItem(
      'light-reader-opds',
      JSON.stringify({ state: { catalogs: [{ id: 1, url: 'javascript:x' }] } }),
    );
    await useOpdsCatalogs.persist.rehydrate();
    expect(useOpdsCatalogs.getState().catalogs).toEqual([]);
  });
});
