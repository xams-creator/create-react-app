// @remove-on-eject-begin
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// @remove-on-eject-end
'use strict';

// Do this as the first thing so that any code reading it knows the right env.
// 1.设定基础环境变量，用于 babel 插件和 webpack config 内容获取

process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.

// 2.全局处理
process.on('unhandledRejection', err => {
  throw err;
});

// Ensure environment variables are read.

// 3.处理环境变量 （1.确认相关目录的path，2.通过 dotenv 加载值到环境变量，3.提供一个用于webpack.DefinePlugin的客户端环境变量对象）
require('../config/env');
// @remove-on-eject-begin
// Do the preflight check (only happens before eject).

// 4.从 node_modules 检查react-scripts相关依赖
const verifyPackageTree = require('./utils/verifyPackageTree');
if (process.env.SKIP_PREFLIGHT_CHECK !== 'true') {
  verifyPackageTree();
}

// 5.假如使用了 typescript，将检查并重写 app目录的 tsconfig （使用 react 17.0.0 的同学可能有感知，react-scripts start 时会提示并要求更改某些编译选项）
const verifyTypeScriptSetup = require('./utils/verifyTypeScriptSetup');
verifyTypeScriptSetup();
// @remove-on-eject-end

const fs = require('fs');
const chalk = require('react-dev-utils/chalk'); // 相当于 require('chalk')

// 6.引用 webpack 相关内容
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');

const clearConsole = require('react-dev-utils/clearConsole'); // 跨平台的清除 console ,类似于 win cls 和 linux reset,clear
const checkRequiredFiles = require('react-dev-utils/checkRequiredFiles'); // 检查文件是否可用的工具
const {
  choosePort, // 当端口被占用时，提示并让用户确认是否换端口
  createCompiler, // 根据提供的 webpack config，创建 webpack compiler ，绑定一些 hooks 事件，当 返回失败，警告等消息时，通过 socket 传给前端，用来做 热重载 功能， react 16之前,代码修改后会触发 reload,16之后通过 ReactRefresh 组价实现无刷新
  prepareProxy,   // 处理package.json的 proxy内容，提供给 http-proxy-middleware 需要的参数
  prepareUrls,  // 获取ip信息，用于第一次编译成功后的信息打印等
} = require('react-dev-utils/WebpackDevServerUtils');
const openBrowser = require('react-dev-utils/openBrowser'); // 封装了 open，实现了应用启动后打开浏览器的功能
const semver = require('semver'); // npm 版本语义控制
const paths = require('../config/paths');
const configFactory = require('../config/webpack.config');  // 根据提供的 env，获取 webpack config，重点！
const createDevServerConfig = require('../config/webpackDevServer.config'); // webpack dev server config，重点！
const getClientEnvironment = require('../config/env');  // 根据 process.env ，使用 webpack.DefinePlugin 可以使用的客户端全局常量
const react = require(require.resolve('react', { paths: [paths.appPath] }));  // 相当于 require app目录的 react，用于获取react版本号

const env = getClientEnvironment(paths.publicUrlOrPath.slice(0, -1));
const useYarn = fs.existsSync(paths.yarnLockFile);  // 判断是否使用 yarn
const isInteractive = process.stdout.isTTY;   // 判断是否终端环境 isTTY === true

// Warn and crash if required files are missing
// 7.检查 webpack 不可或缺的内容。检查 app 的 html文件 和 入口 js文件，是否有操作权限
if (!checkRequiredFiles([paths.appHtml, paths.appIndexJs])) {
  process.exit(1);
}

// 8.读取环境变量配置的端口号，默认为 3000，设置 HOST

// Tools like Cloud9 rely on this.
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 9.如果在环境变量中设置了 HOST ，那么打log
if (process.env.HOST) {
  console.log(
    chalk.cyan(
      `Attempting to bind to HOST environment variable: ${chalk.yellow(
        chalk.bold(process.env.HOST)
      )}`
    )
  );
  console.log(
    `If this was unintentional, check that you haven't mistakenly set it in your shell.`
  );
  console.log(
    `Learn more here: ${chalk.yellow('https://cra.link/advanced-config')}`
  );
  console.log();
}

// We require that you explicitly set browsers and do not fall back to
// browserslist defaults.
// 10.react-scripts 引用了 browserslist 这个库，在启动时会检查 package.json 是否存在 browserslist 配置，如果不存在，会提示用户让用户确认使用默认值
const { checkBrowsers } = require('react-dev-utils/browsersHelper');
checkBrowsers(paths.appPath, isInteractive)
  .then(() => {
    // We attempt to use the default port but if it is busy, we offer the user to
    // run on a different port. `choosePort()` Promise resolves to the next free port.

    // 11.主要是确认一个可用的 PORT，因为可能存在端口占用的问题
    return choosePort(HOST, DEFAULT_PORT);
  })
  .then(port => {
    if (port == null) {
      // We have not found a port.
      return;
    }

    // 12.获取 development 环境的 webpack config
    const config = configFactory('development');
    const protocol = process.env.HTTPS === 'true' ? 'https' : 'http';
    const appName = require(paths.appPackageJson).name;

      // 13.根据 app 目录下是否有 tsconfig.json 判断是否使用 ts
    const useTypeScript = fs.existsSync(paths.appTsConfig);
    const tscCompileOnError = process.env.TSC_COMPILE_ON_ERROR === 'true';

      // 14.提供使用的协议，端口等信息确认将使用的 url
    const urls = prepareUrls(
      protocol,
      HOST,
      port,
      paths.publicUrlOrPath.slice(0, -1)
    );

    // 15.使用 ws 推送数据给前端，前端拿到数据后 做 hot 判断
    const devSocket = {
      warnings: warnings =>
        devServer.sockWrite(devServer.sockets, 'warnings', warnings),
      errors: errors =>
        devServer.sockWrite(devServer.sockets, 'errors', errors),
    };
    // 16.创建 webpack compiler
    const compiler = createCompiler({
      appName,
      config,
      devSocket,
      urls,
      useYarn,
      useTypeScript,
      tscCompileOnError,
      webpack,
    });
    // 17.加载 proxy 信息，最终会提供给 devServer.proxy
    const proxySetting = require(paths.appPackageJson).proxy;
    const proxyConfig = prepareProxy(
      proxySetting,
      paths.appPublic,
      paths.publicUrlOrPath
    );
    // 18.获取最终的 devServer 配置
    const serverConfig = createDevServerConfig(
      proxyConfig,
      urls.lanUrlForConfig
    );

    // 19.创建并启动devServer并且打开浏览器
    const devServer = new WebpackDevServer(compiler, serverConfig);
    // Launch WebpackDevServer.
    devServer.listen(port, HOST, err => {
      if (err) {
        return console.log(err);
      }
      if (isInteractive) {
        clearConsole();
      }

      if (env.raw.FAST_REFRESH && semver.lt(react.version, '16.10.0')) {
        console.log(
          chalk.yellow(
            `Fast Refresh requires React 16.10 or higher. You are using React ${react.version}.`
          )
        );
      }

      console.log(chalk.cyan('Starting the development server...\n'));
      openBrowser(urls.localUrlForBrowser);
    });

    // 20.当收到 process 信号时关闭服务器
    ['SIGINT', 'SIGTERM'].forEach(function (sig) {
      process.on(sig, function () {
        devServer.close();
        process.exit();
      });
    });

    if (process.env.CI !== 'true') {
      // Gracefully exit when stdin ends
      process.stdin.on('end', function () {
        devServer.close();
        process.exit();
      });
    }
  })
  .catch(err => {
    if (err && err.message) {
      console.log(err.message);
    }
    process.exit(1);
  });
