/* eslint-disable no-undef */

/*
 * Build for the AGG custom functions add-in, from the Office generator's
 * "Excel custom functions using a shared runtime" template.
 *
 * The API base is fixed at build time as __API_BASE__:
 *   development  http://localhost:8001, the local server (`aggregate-api --port 8001`)
 *   production   empty, so the add-in calls the origin that serves it
 * AGG_API_BASE overrides either.
 *
 * A production build also writes the production manifest.xml from the
 * development one: every https://localhost:3000 URL moves under AGG_ADDIN_BASE
 * (default https://agg.mynl.com/excel), <Version> is the server's __version__
 * padded to four parts, and <Id> is the production add-in's own, so the two can
 * be loaded side by side. scripts/build-excel.ps1 and .sh set the base.
 */

const fs = require("fs");
const path = require("path");
const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const CustomFunctionsMetadataPlugin = require("custom-functions-metadata-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

/* global require, module, process, __dirname */

const DEV_ORIGIN = "https://localhost:3000";
const DEV_ID = "adb0cf15-8d8e-46ea-a6b6-c63274b97845";
const PRODUCTION_ID = "2ec476d0-fa41-461b-b879-e66c05456eef";
const PRODUCTION_BASE = "https://agg.mynl.com/excel";

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

/*
 * The server's version as Office wants it: four numeric parts. Read from the
 * one place the version is written, so the manifest cannot disagree with
 * /v1/meta. 1.17.0 becomes 1.17.0.0.
 */
function manifestVersion() {
  const init = path.join(__dirname, "..", "src", "aggregate_api", "__init__.py");
  const match = /^__version__ = "(\d+)\.(\d+)\.(\d+)/m.exec(fs.readFileSync(init, "utf8"));
  if (!match) throw new Error(`no __version__ in ${init}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

/* The development manifest rewritten for `base`, which has no trailing slash. */
function productionManifest(content, base) {
  const text = content.toString();
  for (const needle of [DEV_ORIGIN, DEV_ID, "<Version>1.0.0.0</Version>"]) {
    if (!text.includes(needle)) throw new Error(`manifest.xml no longer contains ${needle}`);
  }
  return text
    .replace(/<!--[\s\S]*?-->/,
             `<!-- Production manifest for ${base}, written by excel/webpack.config.js ` +
             "from the development manifest. Install it from this URL; see excel/README.md. -->")
    .split(DEV_ORIGIN)
    .join(base)
    .replace(DEV_ID, PRODUCTION_ID)
    .replace("<Version>1.0.0.0</Version>", `<Version>${manifestVersion()}</Version>`);
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const apiBase = process.env.AGG_API_BASE ?? (dev ? "http://localhost:8001" : "");
  const addinBase = (process.env.AGG_ADDIN_BASE || PRODUCTION_BASE).replace(/\/+$/, "");
  const config = {
    devtool: "source-map",
    entry: {
      polyfill: ["core-js/stable", "regenerator-runtime/runtime"],
      taskpane: ["./src/taskpane/taskpane.ts", "./src/taskpane/taskpane.html"],
      functions: "./src/functions/functions.ts",
    },
    output: {
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".html", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
          },
        },
        {
          test: /\.html$/,
          exclude: /node_modules/,
          use: "html-loader",
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext][query]",
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({ __API_BASE__: JSON.stringify(apiBase) }),
      new CustomFunctionsMetadataPlugin({
        output: "functions.json",
        input: "./src/functions/functions.ts",
      }),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["polyfill", "taskpane", "functions"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets/*",
            to: "assets/[name][ext][query]",
          },
          {
            from: "manifest*.xml",
            to: "[name]" + "[ext]",
            transform(content) {
              return dev ? content : productionManifest(content, addinBase);
            },
          },
        ],
      }),
    ],
    devServer: {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options: env.WEBPACK_BUILD || options.https !== undefined ? options.https : await getHttpsOptions(),
      },
      port: process.env.npm_package_config_dev_server_port || 3000,
    },
  };

  return config;
};
