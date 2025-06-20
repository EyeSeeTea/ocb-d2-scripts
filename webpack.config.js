const path = require("path");
const nodeExternals = require("webpack-node-externals");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
    context: __dirname,
    entry: "./src/index.ts",
    externals: [nodeExternals()],
    module: {
        rules: [
            {
                exclude: /node_modules/,
                test: /.ts$/,
                use: {
                    loader: "ts-loader",
                },
            },
            {
                test: /\.sql$/i,
                type: "asset/source",
            },
        ],
    },
    node: {
        __dirname: false,
    },
    resolve: {
        extensions: [".ts", ".js"],
        plugins: [
            new TsconfigPathsPlugin({
                extensions: [".js", ".ts"],
                baseUrl: "./src",
            }),
        ],
    },
    output: {
        filename: "index.js",
        path: path.resolve(__dirname, "dist"),
        publicPath: "/dist/",
    },
    target: "node",
};
