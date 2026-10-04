export interface PaginationInput<Cursor> {
  cursor?: Cursor;
  limit: number;
}

export interface PaginationResponse {
  limit: number;
  nextCursor?: string;
}
