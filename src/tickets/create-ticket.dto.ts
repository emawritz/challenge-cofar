import { Transform, Type } from 'class-transformer';
import { IsInt, Length, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @Transform(trim)
  @Length(1, 120, { message: 'El título debe tener entre 1 y 120 caracteres.' })
  title: string;

  @Transform(trim)
  @Length(1, 5000, { message: 'La descripción debe tener entre 1 y 5000 caracteres.' })
  description: string;

  @Type(() => Number)
  @IsInt({ message: 'Elegí una categoría.' })
  @Min(1, { message: 'Elegí una categoría.' })
  categoryId: number;
}
