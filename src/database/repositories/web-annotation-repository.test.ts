import {
  createTestAnnotation,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { WebAnnotationRepository } from './web-annotation-repository';

describe('WebAnnotationRepository', () => {
  it('creates, reads, updates, lists, and deletes annotations', async () => {
    const database = createTestWebDatabase();
    const repository = new WebAnnotationRepository(database);
    await repository.create(createTestAnnotation());
    await repository.create(
      createTestAnnotation({ id: 'annotation-2', createdAt: 5 }),
    );
    await repository.create(
      createTestAnnotation({ id: 'elsewhere', bookId: 'book-2' }),
    );

    await expect(repository.findByBookId('book-1')).resolves.toMatchObject([
      { id: 'annotation-2' },
      { id: 'annotation-1' },
    ]);
    await expect(
      repository.updateColor('annotation-1', 'blue'),
    ).resolves.toMatchObject({ color: 'blue' });
    await expect(
      repository.updateNote('annotation-1', '我的批注'),
    ).resolves.toMatchObject({ noteText: '我的批注', color: 'blue' });
    await expect(
      new WebAnnotationRepository(database).findById('annotation-1'),
    ).resolves.toMatchObject({ noteText: '我的批注' });

    await repository.delete('annotation-1');
    await expect(repository.findById('annotation-1')).resolves.toBeNull();
  });

  it('maps duplicate, missing, and corrupt records to typed errors', async () => {
    const database = createTestWebDatabase();
    const repository = new WebAnnotationRepository(database);
    await repository.create(createTestAnnotation());

    await expect(
      repository.create(createTestAnnotation()),
    ).rejects.toMatchObject({ code: 'ANNOTATION_WRITE_FAILED' });
    await expect(
      repository.updateColor('missing', 'red'),
    ).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' });

    await database.write([
      {
        type: 'put',
        store: 'annotations',
        value: { id: 'broken', bookId: 'book-1' },
      },
    ]);
    await expect(repository.findByBookId('book-1')).rejects.toMatchObject({
      code: 'ANNOTATION_READ_FAILED',
    });
  });
});
