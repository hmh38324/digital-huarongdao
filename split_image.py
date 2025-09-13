#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片九宫格分割工具
将一张图片按照3x3的网格分割为9个小图片
"""

from PIL import Image
import os

def split_image_into_nine(image_path, output_dir="split_images"):
    """
    将图片填充为正方形后分割为九宫格
    
    Args:
        image_path (str): 输入图片路径
        output_dir (str): 输出目录
    """
    # 打开图片
    try:
        img = Image.open(image_path)
        print(f"成功打开图片: {image_path}")
        print(f"原始图片尺寸: {img.size[0]} x {img.size[1]}")
    except Exception as e:
        print(f"无法打开图片: {e}")
        return
    
    # 创建输出目录
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"创建输出目录: {output_dir}")
    
    # 获取原始图片尺寸
    width, height = img.size
    
    # 计算正方形边长（取较大的尺寸）
    square_size = max(width, height)
    print(f"填充为正方形尺寸: {square_size} x {square_size}")
    
    # 创建正方形画布（透明背景）
    square_img = Image.new('RGBA', (square_size, square_size), (0, 0, 0, 0))
    
    # 计算图片在正方形中的位置（居中）
    paste_x = (square_size - width) // 2
    paste_y = (square_size - height) // 2
    
    # 将原图片粘贴到正方形画布上
    square_img.paste(img, (paste_x, paste_y))
    
    # 保存填充后的正方形图片
    square_output_path = os.path.join(output_dir, "liqun_square.png")
    square_img.save(square_output_path)
    print(f"保存填充后的正方形图片: {square_output_path}")
    
    # 计算每个小正方形的尺寸
    cell_size = square_size // 3
    print(f"每个小正方形尺寸: {cell_size} x {cell_size}")
    
    # 分割图片为九宫格
    for row in range(3):
        for col in range(3):
            # 计算裁剪区域
            left = col * cell_size
            top = row * cell_size
            right = left + cell_size
            bottom = top + cell_size
            
            # 裁剪图片
            cropped_img = square_img.crop((left, top, right, bottom))
            
            # 生成输出文件名
            output_filename = f"liqun_part_{row+1}_{col+1}.png"
            output_path = os.path.join(output_dir, output_filename)
            
            # 保存图片
            cropped_img.save(output_path)
            print(f"保存: {output_path}")
    
    print(f"\n分割完成！共生成9个相同大小的正方形图片，保存在 {output_dir} 目录中")
    print("文件命名规则: liqun_part_行号_列号.png")
    print("例如: liqun_part_1_1.png 表示第1行第1列")
    print("所有小图片都是 {0} x {0} 像素的正方形".format(cell_size))

if __name__ == "__main__":
    # 输入图片路径
    input_image = "liqun.png"
    
    # 检查文件是否存在
    if not os.path.exists(input_image):
        print(f"错误: 找不到文件 {input_image}")
        exit(1)
    
    # 执行分割
    split_image_into_nine(input_image)
