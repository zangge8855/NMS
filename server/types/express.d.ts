import express from 'express';

declare global {
    namespace Express {
        interface Request {
            user?: any;
            id?: string;
            file?: any;
            files?: any;
        }
    }
}

export {};
