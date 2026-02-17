module.exports = {
    apps: [
        {
            name: 'nms',
            script: './server/index.js',
            cwd: __dirname,
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/error.log',
            out_file: './logs/out.log',
        },
    ],
};
