# 故障排查

面板跑起来了，但有些东西不对。



## 列表里没有这个产品

桥接从**运行 Harness 那个进程**的 `PATH` 里解析 `codex` 和 `claude`，而这未必是你测试时所用终端的 `PATH`。在按 shell 切换版本的管理器下（fnm、nvm、asdf），为某个 Node 版本装的产品，对以另一个版本启动的 Harness 是不可见的——于是面板对一个你手工能跑起来的产品报 `not-installed`，而这个判断是对的。

```sh
# macOS、Linux —— 读出正在运行的 Harness 进程的 PATH
ps eww -p "$(pgrep -f 'dsh web' | head -1)" | tr ' ' '\n' | grep '^PATH='

# 然后从一个能解析到该产品的 shell 里启动
PATH="$PATH:/path/to/product/bin" dsh --profile web
```

面板会在任何 `not-installed` 的产品旁边就地给出这条提示。

## 产品装了，但没就绪

在启动 Harness 的那个 shell 里跑它的 `--version`，和[兼容性文档](compatibility.md)对照。面板会同时给出已安装版本和准许范围。除非你自己验证过协议，否则不要打开 `allowExperimentalVersions`。

## 浏览器要我登录

这里刻意没有登录按钮。请在主机的终端里用产品本身的命令登录，然后按刷新——刷新会重新探测两个产品，所以不需要重启 Profile。

更多内容见[运维文档](operations.md)。
