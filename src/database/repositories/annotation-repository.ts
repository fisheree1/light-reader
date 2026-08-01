import type {
  Annotation,
  AnnotationColor,
} from '../../features/annotations/domain/annotation';

export interface AnnotationRepository {
  create(annotation: Annotation): Promise<Annotation>;
  findByBookId(bookId: string): Promise<Annotation[]>;
  findById(id: string): Promise<Annotation | null>;
  updateColor(id: string, color: AnnotationColor): Promise<Annotation>;
  updateNote(id: string, noteText: string | null): Promise<Annotation>;
  delete(id: string): Promise<void>;
}
