import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Clock } from './clock';
import { DB, Db } from './token';
import { categories, users } from './schema';

export const SEED_USERS = [
  { id: 1, name: 'Ana Pérez', email: 'ana@example.com', role: 'REQUESTER' as const },
  { id: 2, name: 'Bruno Díaz', email: 'bruno@example.com', role: 'REQUESTER' as const },
  { id: 3, name: 'Carla Soto', email: 'carla@example.com', role: 'AGENT' as const },
  { id: 4, name: 'Diego Ruiz', email: 'diego@example.com', role: 'AGENT' as const },
];
export const SEED_CATEGORIES = ['Hardware', 'Software', 'Accesos', 'Redes', 'Otros'];

export function seed(db: Db, nowIso: string): void {
  db.transaction((tx) => {
    for (const u of SEED_USERS) tx.insert(users).values({ ...u, createdAt: nowIso }).onConflictDoNothing().run();
    SEED_CATEGORIES.forEach((name, i) =>
      tx.insert(categories).values({ id: i + 1, name, active: true }).onConflictDoNothing().run(),
    );
  });
}

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db, private readonly clock: Clock) {}
  onModuleInit(): void {
    seed(this.db, this.clock.now().toISOString());
  }
}
