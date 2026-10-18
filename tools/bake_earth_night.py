# -*- coding: utf-8 -*-
"""
bake_earth_night.py — 烘焙地球夜面城市灯光 + 鲜艳版 albedo

输入（assets/baked/，此前已从 NASA Blue Marble + GEBCO 烘焙）：
  earth_albedo_2048.jpg   白昼反照率
  earth_elev_2048.png     高程（0 = 海平面，>0 = 陆地）

输出：
  earth_night_2048.jpg      夜面城市灯光（RGB，琥珀色）
  earth_albedo_vivid_2048.jpg  饱和度提升版 albedo

设计依据（参考图 206deb：国际空间站视角的昼夜球）：
  夜面灯光的真实分布规律：
    1. 绝大多数大城市在沿海/沿河低地 —— 用「到海岸线的距离」做指数衰减权重
    2. 沙漠（撒哈拉）、雨林腹地（亚马逊）灯光稀少 —— 用 albedo 的绿色通道
       当「植被/宜居度」代理：绿 = 有农业 = 有人口
    3. 灯光成「簇」：城市群 + 孤立小城 —— 两尺度高斯聚簇噪声
    4. 颜色是暖琥珀色（钠灯/白炽灯），不是纯白
"""

import os
import sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
BAKED = os.path.normpath(os.path.join(HERE, '..', 'assets', 'baked'))

W, H = 2048, 1024


def log(msg):
    print(msg, flush=True)


def main():
    # ---------- 1. 读入 ----------
    alb = np.asarray(Image.open(os.path.join(BAKED, 'earth_albedo_2048.jpg')).convert('RGB'),
                     dtype=np.float32) / 255.0
    elev_path = os.path.join(BAKED, 'earth_elev_2048.png')
    elev = np.asarray(Image.open(elev_path).convert('L'), dtype=np.float32) / 255.0
    log('albedo %s  elev %s' % (alb.shape, elev.shape))
    if elev.shape[:2] != (H, W):
        im = Image.fromarray((elev * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
        elev = np.asarray(im, dtype=np.float32) / 255.0

    # ---------- 2. 陆地掩模 ----------
    # 高程为主（>0.004 视为陆地，容掉海面量化噪声），蓝色占优兜底判海
    oceanish = (alb[..., 2] > alb[..., 0] * 1.06) & (alb[..., 2] > alb[..., 1] * 1.04)
    land = (elev > 0.004) & (~oceanish)
    land_frac = land.mean()
    log('陆地占比 %.1f%% (真实值约 29%%)' % (land_frac * 100))

    # ---------- 3. 到海岸的距离 ----------
    # distance_transform_edt：每个陆地像素到最近「非陆地(海)」像素的距离
    dist = ndimage.distance_transform_edt(land)
    # 归一到像素数 -> 权重：0~60 px(约 0~200km 内陆) 衰减最快
    coastal = np.exp(-dist / 46.0)
    coastal[~land] = 0.0

    # ---------- 4. 宜居度（绿色植被代理）----------
    g = alb[..., 1]
    r = alb[..., 0]
    greenness = np.clip((g - r) * 2.2 + 0.18, 0.0, 1.0)   # 绿>红 的程度
    # 极地(冰雪)没人：按纬度把 |lat|>72° 压掉。latv 是 (H,1)，沿列广播
    latv = np.abs((np.arange(H) + 0.5) / H * 2.0 - 1.0)[:, None]   # 0~1
    polar = np.clip((latv - 0.80) / 0.14, 0.0, 1.0)
    habit = greenness * (1.0 - polar)
    habit[~land] = 0.0

    # ---------- 5. 两尺度聚簇噪声 ----------
    rng = np.random.default_rng(20260922)
    def cluster(sigma):
        n = rng.random((H, W)).astype(np.float32)
        return ndimage.gaussian_filter(n, sigma)
    c_big = cluster(9.0)     # 城市群尺度（数百公里）
    c_small = cluster(2.4)   # 单城尺度
    c_big = (c_big - c_big.mean()) / (c_big.std() + 1e-6)
    c_small = (c_small - c_small.mean()) / (c_small.std() + 1e-6)
    clus = 0.62 * np.clip(c_big * 0.5 + 0.5, 0, 1) + 0.38 * np.clip(c_small * 0.5 + 0.5, 0, 1)

    # ---------- 6. 合成灯光强度 ----------
    inten = (coastal ** 0.85) * (0.25 + 0.75 * habit) * (clus ** 1.7)
    inten[~land] = 0.0
    # 只有强度前 3.5% 的像素亮灯（覆盖率约 0.8%~1.2%）——
    # 从轨道看，真实城市的灯光连成网，覆盖率其实不低；太稀就看不见
    thr = np.percentile(inten[inten > 0], 96.5)
    core = np.clip((inten - thr) / (inten.max() - thr + 1e-6), 0.0, 1.0)
    log('亮灯像素占比 %.2f%%' % ((core > 0).mean() * 100))

    # ---------- 7. 辉光 + 颜色 ----------
    # 小核锐利（城市本体），大核柔和（光污染弥散）
    glow_s = ndimage.gaussian_filter(core, 1.2)
    glow_b = ndimage.gaussian_filter(core, 7.0)
    lum = np.clip(glow_s * 1.35 + glow_b * 0.85, 0.0, 1.0)
    # 暖琥珀：低强度偏橙，高强度偏暖白
    t = lum[..., None]
    warm = np.array([1.00, 0.72, 0.38], dtype=np.float32)   # 钠灯橙
    hot = np.array([1.00, 0.93, 0.78], dtype=np.float32)    # 满城暖白
    rgb = warm[None, None, :] * (1 - t) + hot[None, None, :] * t
    night = (rgb * lum[..., None] * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(night).save(os.path.join(BAKED, 'earth_night_2048.jpg'), quality=90)
    log('earth_night_2048.jpg  最大亮度 %d' % night.max())

    # ---------- 8. 鲜艳版 albedo ----------
    img = Image.open(os.path.join(BAKED, 'earth_albedo_2048.jpg')).convert('RGB')
    vivid = ImageEnhance.Color(img).enhance(1.30)       # 参考图大陆更绿、海洋更蓝
    vivid = ImageEnhance.Contrast(vivid).enhance(1.06)  # 轻微提对比
    vivid.save(os.path.join(BAKED, 'earth_albedo_vivid_2048.jpg'), quality=92)
    log('earth_albedo_vivid_2048.jpg 完成')

    # ---------- 9. 预览（等距柱状夜图）----------
    prev = Image.fromarray(night).resize((1024, 512), Image.LANCZOS)
    prev.save(os.path.join(BAKED, '_preview_night.jpg'), quality=88)
    log('全部完成')


if __name__ == '__main__':
    main()
