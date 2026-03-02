/**
 * Type-safe query builder (INFRA-007).
 * Fluent API for building database queries with pagination and aggregation.
 */

import type { DbAdapter, QueryResult } from "./db-adapter.js";

/**
 * Sort direction.
 */
export type SortDirection = "asc" | "desc";

/**
 * Comparison operators.
 */
export type ComparisonOp =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "like"
  | "in"
  | "not_in"
  | "is_null"
  | "is_not_null";

/**
 * Filter condition.
 */
export interface FilterCondition {
  field: string;
  op: ComparisonOp;
  value: unknown;
}

/**
 * Sort specification.
 */
export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/**
 * Pagination options.
 */
export interface PaginationSpec {
  type: "offset" | "cursor";
  limit: number;
  offset?: number;
  cursor?: string;
  cursorField?: string;
}

/**
 * Aggregation function.
 */
export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";

/**
 * Aggregation specification.
 */
export interface AggregateSpec {
  fn: AggregateFunction;
  field: string;
  alias: string;
}

/**
 * Time bucket specification.
 */
export interface TimeBucketSpec {
  field: string;
  bucket: "hour" | "day" | "week" | "month" | "year";
  alias: string;
}

/**
 * Query result with pagination info.
 */
export interface PaginatedQueryResult<T> {
  rows: T[];
  total?: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Built query.
 */
export interface BuiltQuery {
  sql: string;
  params: unknown[];
  countSql?: string;
}

/**
 * Query builder interface.
 */
export interface QueryBuilder<T = Record<string, unknown>> {
  /** Select specific fields */
  select(...fields: string[]): QueryBuilder<T>;

  /** Set the table name */
  from(table: string): QueryBuilder<T>;

  /** Add a WHERE condition */
  where(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T>;

  /** Add an AND condition */
  and(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T>;

  /** Add an OR condition */
  or(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T>;

  /** Add ORDER BY */
  orderBy(field: string, direction?: SortDirection): QueryBuilder<T>;

  /** Add GROUP BY */
  groupBy(...fields: string[]): QueryBuilder<T>;

  /** Add HAVING clause */
  having(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T>;

  /** Set LIMIT */
  limit(n: number): QueryBuilder<T>;

  /** Set OFFSET */
  offset(n: number): QueryBuilder<T>;

  /** Use cursor-based pagination */
  cursor(cursor: string, field: string): QueryBuilder<T>;

  /** Add aggregation */
  aggregate(fn: AggregateFunction, field: string, alias?: string): QueryBuilder<T>;

  /** Add time bucket for time-series */
  timeBucket(field: string, bucket: TimeBucketSpec["bucket"], alias?: string): QueryBuilder<T>;

  /** Build the query */
  build(): BuiltQuery;

  /** Execute the query */
  execute(): Promise<QueryResult<T>>;

  /** Execute with pagination info */
  paginate(): Promise<PaginatedQueryResult<T>>;
}

/**
 * SQL query builder implementation.
 */
export class SqlQueryBuilder<T = Record<string, unknown>> implements QueryBuilder<T> {
  private _select: string[] = ["*"];
  private _from: string = "";
  private _conditions: Array<{ type: "and" | "or"; condition: FilterCondition }> = [];
  private _orderBy: SortSpec[] = [];
  private _groupBy: string[] = [];
  private _having: FilterCondition[] = [];
  private _limit?: number;
  private _offset?: number;
  private _cursor?: { value: string; field: string };
  private _aggregates: AggregateSpec[] = [];
  private _timeBuckets: TimeBucketSpec[] = [];

  constructor(private db: DbAdapter) {}

  select(...fields: string[]): QueryBuilder<T> {
    this._select = fields.length > 0 ? fields : ["*"];
    return this;
  }

  from(table: string): QueryBuilder<T> {
    this._from = table;
    return this;
  }

  where(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T> {
    this._conditions.push({ type: "and", condition: { field, op, value } });
    return this;
  }

  and(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T> {
    return this.where(field, op, value);
  }

  or(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T> {
    this._conditions.push({ type: "or", condition: { field, op, value } });
    return this;
  }

  orderBy(field: string, direction: SortDirection = "asc"): QueryBuilder<T> {
    this._orderBy.push({ field, direction });
    return this;
  }

  groupBy(...fields: string[]): QueryBuilder<T> {
    this._groupBy.push(...fields);
    return this;
  }

  having(field: string, op: ComparisonOp, value: unknown): QueryBuilder<T> {
    this._having.push({ field, op, value });
    return this;
  }

  limit(n: number): QueryBuilder<T> {
    this._limit = n;
    return this;
  }

  offset(n: number): QueryBuilder<T> {
    this._offset = n;
    return this;
  }

  cursor(cursor: string, field: string): QueryBuilder<T> {
    this._cursor = { value: cursor, field };
    return this;
  }

  aggregate(fn: AggregateFunction, field: string, alias?: string): QueryBuilder<T> {
    this._aggregates.push({ fn, field, alias: alias ?? `${fn}_${field}` });
    return this;
  }

  timeBucket(field: string, bucket: TimeBucketSpec["bucket"], alias?: string): QueryBuilder<T> {
    this._timeBuckets.push({ field, bucket, alias: alias ?? `${bucket}_bucket` });
    return this;
  }

  build(): BuiltQuery {
    const params: unknown[] = [];
    let sql = "SELECT ";

    // Build SELECT clause
    const selectParts: string[] = [];

    // Regular fields
    if (this._aggregates.length === 0 && this._timeBuckets.length === 0) {
      selectParts.push(...this._select);
    } else {
      // With aggregations, need explicit fields
      if (this._groupBy.length > 0) {
        selectParts.push(...this._groupBy);
      }
    }

    // Add aggregates
    for (const agg of this._aggregates) {
      if (agg.fn === "count" && agg.field === "*") {
        selectParts.push(`COUNT(*) AS ${agg.alias}`);
      } else {
        selectParts.push(`${agg.fn.toUpperCase()}(${agg.field}) AS ${agg.alias}`);
      }
    }

    // Add time buckets (SQLite compatible)
    for (const tb of this._timeBuckets) {
      const expr = this.buildTimeBucketExpr(tb);
      selectParts.push(`${expr} AS ${tb.alias}`);
    }

    sql += selectParts.length > 0 ? selectParts.join(", ") : "*";

    // FROM clause
    sql += ` FROM ${this._from}`;

    // WHERE clause
    if (this._conditions.length > 0 || this._cursor) {
      sql += " WHERE ";
      const whereParts: string[] = [];

      for (let i = 0; i < this._conditions.length; i++) {
        const entry = this._conditions[i];
        if (!entry) continue;
        const { type, condition } = entry;
        const conditionSql = this.buildCondition(condition, params);

        if (i === 0) {
          whereParts.push(conditionSql);
        } else {
          whereParts.push(`${type.toUpperCase()} ${conditionSql}`);
        }
      }

      // Add cursor condition
      if (this._cursor) {
        const cursorCond = `${this._cursor.field} > ?`;
        params.push(this._cursor.value);
        if (whereParts.length > 0) {
          whereParts.push(`AND ${cursorCond}`);
        } else {
          whereParts.push(cursorCond);
        }
      }

      sql += whereParts.join(" ");
    }

    // GROUP BY clause
    if (this._groupBy.length > 0 || this._timeBuckets.length > 0) {
      const groupFields = [...this._groupBy];
      for (const tb of this._timeBuckets) {
        groupFields.push(tb.alias);
      }
      sql += ` GROUP BY ${groupFields.join(", ")}`;
    }

    // HAVING clause
    if (this._having.length > 0) {
      sql += " HAVING ";
      sql += this._having.map((h) => this.buildCondition(h, params)).join(" AND ");
    }

    // ORDER BY clause
    if (this._orderBy.length > 0) {
      sql += " ORDER BY ";
      sql += this._orderBy.map((s) => `${s.field} ${s.direction.toUpperCase()}`).join(", ");
    }

    // LIMIT/OFFSET
    if (this._limit !== undefined) {
      sql += ` LIMIT ${this._limit}`;
    }
    if (this._offset !== undefined) {
      sql += ` OFFSET ${this._offset}`;
    }

    // Build count query
    let countSql: string | undefined;
    if (this._limit !== undefined) {
      countSql = `SELECT COUNT(*) AS total FROM ${this._from}`;
      if (this._conditions.length > 0) {
        const countParams: unknown[] = [];
        countSql += " WHERE ";
        countSql += this._conditions
          .map(({ type, condition }, i) => {
            const cond = this.buildCondition(condition, countParams);
            return i === 0 ? cond : `${type.toUpperCase()} ${cond}`;
          })
          .join(" ");
      }
    }

    const built: BuiltQuery = { sql, params };
    if (countSql) built.countSql = countSql;
    return built;
  }

  async execute(): Promise<QueryResult<T>> {
    const { sql, params } = this.build();
    return this.db.query<T>(sql, params);
  }

  async paginate(): Promise<PaginatedQueryResult<T>> {
    const { sql, params, countSql } = this.build();

    const result = await this.db.query<T>(sql, params);

    let total: number | undefined;
    if (countSql) {
      const countResult = await this.db.queryOne<{ total: number }>(
        countSql,
        params.slice(0, this._conditions.length),
      );
      total = countResult?.total;
    }

    const hasMore = this._limit !== undefined && result.rows.length === this._limit;

    const paginatedResult: PaginatedQueryResult<T> = {
      rows: result.rows,
      hasMore,
    };

    if (total !== undefined) paginatedResult.total = total;

    if (hasMore && result.rows.length > 0 && this._cursor) {
      const lastRow = result.rows[result.rows.length - 1] as Record<string, unknown>;
      paginatedResult.nextCursor = String(lastRow[this._cursor.field]);
    }

    return paginatedResult;
  }

  private buildCondition(condition: FilterCondition, params: unknown[]): string {
    const { field, op, value } = condition;

    switch (op) {
      case "=":
      case "!=":
      case ">":
      case ">=":
      case "<":
      case "<=":
        params.push(value);
        return `${field} ${op} ?`;

      case "like":
        params.push(value);
        return `${field} LIKE ?`;

      case "in":
        if (Array.isArray(value)) {
          const placeholders = value.map(() => "?").join(", ");
          params.push(...value);
          return `${field} IN (${placeholders})`;
        }
        params.push(value);
        return `${field} IN (?)`;

      case "not_in":
        if (Array.isArray(value)) {
          const placeholders = value.map(() => "?").join(", ");
          params.push(...value);
          return `${field} NOT IN (${placeholders})`;
        }
        params.push(value);
        return `${field} NOT IN (?)`;

      case "is_null":
        return `${field} IS NULL`;

      case "is_not_null":
        return `${field} IS NOT NULL`;

      default:
        params.push(value);
        return `${field} = ?`;
    }
  }

  private buildTimeBucketExpr(tb: TimeBucketSpec): string {
    // SQLite date functions
    switch (tb.bucket) {
      case "hour":
        return `strftime('%Y-%m-%d %H:00', ${tb.field})`;
      case "day":
        return `date(${tb.field})`;
      case "week":
        return `date(${tb.field}, 'weekday 0', '-6 days')`;
      case "month":
        return `strftime('%Y-%m', ${tb.field})`;
      case "year":
        return `strftime('%Y', ${tb.field})`;
      default:
        return `date(${tb.field})`;
    }
  }
}

/**
 * Create a query builder for the given database adapter.
 */
export function createQueryBuilder<T = Record<string, unknown>>(db: DbAdapter): QueryBuilder<T> {
  return new SqlQueryBuilder<T>(db);
}

/**
 * Shorthand for creating a query on a table.
 */
export function query<T = Record<string, unknown>>(db: DbAdapter, table: string): QueryBuilder<T> {
  return createQueryBuilder<T>(db).from(table);
}
