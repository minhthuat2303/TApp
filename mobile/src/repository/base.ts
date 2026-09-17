// Repository Pattern Architecture Foundation for T_SHOP Mobile

export interface IDataSource<T> {
  getAll(params?: Record<string, unknown>): Promise<T[]>;
  getById(id: number | string): Promise<T | null>;
}

export interface ILocalDataSource<T> extends IDataSource<T> {
  save(item: T): Promise<void>;
  saveBatch(items: T[]): Promise<void>;
  delete(id: number | string): Promise<void>;
  clear(): Promise<void>;
}

export interface IRemoteDataSource<T> extends IDataSource<T> {
  create?(item: Partial<T>): Promise<T>;
  update?(id: number | string, item: Partial<T>): Promise<T>;
}

export interface IRepository<T> {
  getAll(forceRemote?: boolean): Promise<T[]>;
  getById(id: number | string, forceRemote?: boolean): Promise<T | null>;
}
