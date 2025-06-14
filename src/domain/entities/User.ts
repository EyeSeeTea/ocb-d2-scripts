import { Id } from "./Base";

export type User = {
    id: Id;
    username: string;
    disabled?: boolean;
    firstName?: string;
    surname?: string;
    code?: string;
};
