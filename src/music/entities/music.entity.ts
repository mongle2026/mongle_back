import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('music')
export class MusicEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'external_id', type: 'varchar', length: 100 })
  externalId!: string;

  @Column({ name: 'music_title', type: 'varchar', length: 255 })
  musicTitle!: string;

  @Column({ name: 'music_artist', type: 'varchar', length: 255 })
  musicArtist!: string;

  @Column({ name: 'music_genre', type: 'json', nullable: true })
  musicGenre!: string[] | null;

  @Column({ name: 'music_artwork', type: 'varchar', length: 1000, nullable: true })
  musicArtwork!: string | null;

  @Column({ name: 'preview_url', type: 'varchar', length: 1000, nullable: true })
  previewUrl!: string | null;
}