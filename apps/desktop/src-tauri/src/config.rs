//! 软件商城授权服务对接配置。
//!
//! 真实 API 基础路径为 {SHOP_API_BASE_URL}，
//! 具体 endpoint 在 main.rs 中拼接（/license/verify、/license/deactivate）。
//! 商城无独立激活接口：首次 verify 即绑定设备。

pub const SHOP_API_BASE_URL: &str = "http://124.221.211.237/api";

/// 商城商品页，用于「续费」入口（到期/临期时引导用户打开购买）。
pub const SHOP_PRODUCT_URL: &str = "http://124.221.211.237/product/6";
