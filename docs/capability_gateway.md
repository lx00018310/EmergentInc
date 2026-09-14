# Capability Gateway

## REQUEST_CAPABILITY

Pixel 请求现实能力后：

```text
external_requests/ERxxxx.json
```

Problem 进入 WAITING_EXTERNAL。

## Owner APPROVE

生成公开：

```text
capabilities/CAPxxxx.json
```

公开文件仅包含 capability ID、type、allowed_operations、scope、public_metadata。

真实 credential 放：

```text
owner_private/capabilities/CAPxxxx.json
```

此目录被 gitignore。

## USE_CAPABILITY

Pixel 只提交 capability ID、operation、arguments。

Gateway 读取私有 profile 代执行。

目前内置：
- SSH driver
- ssh_exec

执行结果写入 Problem：

```text
TOOL_VERIFIED
```
