export type Branded<T, B> = T & { __brand: B };

export type Option<T> = Some<T> | None;

export type Some<T> = { type: "some"; value: T };
export type None = { type: "none" };

const some: <T>(value: T) => Some<T> = (value) => ({ type: "some", value });
const none: None = { type: "none" };

export const Option = {
  some,
  none,
  isSome: <T>(opt: Option<T>): opt is Some<T> => opt.type === "some",
  isNone: <T>(opt: Option<T>): opt is None => opt.type === "none",
};
